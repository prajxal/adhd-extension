"""
Auto-repair: rewrite only the sentences the meaning check marked as `problem`, check the
whole passage again, and keep a fix only if it now passes without making anything worse.
"""

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ValidationError

from app.llm.base import LLMOutputError, LLMProvider, LLMProviderError
from app.logging_utils import logger
from app.schemas import CheckSentence, OriginalSentence, Repair, SimplifiedSentence, Status

REPAIR_PROMPT_VERSION = "v1"

LEVEL_RULES = {
    1: "Level 1 = Light: split long sentences, keep the original words where possible. Max 20 words per sentence.",
    2: "Level 2 = Plain: use everyday words. Max 15 words per sentence.",
    3: "Level 3 = Simplest: use the simplest common words. Max 10 words per sentence.",
}

REPAIR_SYSTEM_PROMPT = """\
You fix sentences in a plain-language rewrite that no longer match the original text.

You will get the ORIGINAL sentences numbered like [1], then SENTENCES TO FIX numbered like (0). Each one lists the original sentences it comes from and the problems found in it.

Rules:
- Rewrite each sentence to fix its problems so it says exactly what its original sentences say.
- A sentence often covers only part of its original sentences; other sentences cover the rest. Fix only what is wrong and keep it covering the same part. Do not copy the whole original sentence.
- Keep every number, date, name, condition (if, unless, only if) and negation (not, no, never, without) from the original.
- Keep words like may, might, probably and about when the original uses them.
- Do not add facts, causes, opinions, examples or advice.
- Keep it easy to read. {level_rule}
- Return one rewritten sentence for each sentence to fix, using the same number.

Return only JSON that matches the schema."""

Recheck = Callable[[list[SimplifiedSentence]], tuple[list[CheckSentence], Literal["llm", "rules"]]]

STATUS_RANK: dict[Status, int] = {"ok": 0, "check": 1, "problem": 2}
LEVEL_MAX_WORDS = {1: 20, 2: 15, 3: 10}
# A fix may be a little longer than before, but not re-expand into the whole original.
EXTRA_WORDS_ALLOWED = 5


def too_long(fix: str, previous: str, level: int) -> bool:
    limit = max(LEVEL_MAX_WORDS.get(level, 15), len(previous.split())) + EXTRA_WORDS_ALLOWED
    return len(fix.split()) > limit


class RepairItem(BaseModel):
    index: int
    text: str


class RepairOutput(BaseModel):
    repairs: list[RepairItem]


def build_repair_input(
    original: list[OriginalSentence],
    simplified: list[SimplifiedSentence],
    targets: dict[int, list[str]],
) -> str:
    lines = ["ORIGINAL:", *(f"[{s.id}] {s.text}" for s in original), "", "SENTENCES TO FIX:"]
    for index, reasons in targets.items():
        sentence = simplified[index]
        sources = ", ".join(f"[{i}]" for i in sentence.sourceIds)
        lines.append(f"({index}) {sentence.text}  <- from {sources}")
        lines.append(f"    Problems: {' '.join(reasons) or 'Meaning may have changed.'}")
        # Show what the other sentences from the same original already say, so the fix
        # doesn't repeat them.
        siblings = [
            s.text
            for j, s in enumerate(simplified)
            if j != index and not set(s.sourceIds).isdisjoint(sentence.sourceIds)
        ]
        if siblings:
            lines.append(
                f"    Already covered by other sentences (do not repeat): {' '.join(siblings)}"
            )
    return "\n".join(lines)


def request_repairs(
    provider: LLMProvider,
    original: list[OriginalSentence],
    simplified: list[SimplifiedSentence],
    targets: dict[int, list[str]],
    level: int,
) -> dict[int, str] | None:
    """One call for all targets (one retry on bad JSON). Returns index → new text, or None."""
    system = REPAIR_SYSTEM_PROMPT.format(level_rule=LEVEL_RULES.get(level, LEVEL_RULES[2]))
    user = build_repair_input(original, simplified, targets)
    for attempt in (1, 2):
        try:
            output = provider.generate_json(system, user, RepairOutput)
        except (ValidationError, LLMOutputError):
            logger.warning("repair output invalid attempt=%d", attempt)
            continue
        except LLMProviderError as exc:
            logger.warning("repair unavailable: %s", exc)
            return None
        fixes = {}
        for item in output.repairs:
            text = " ".join(item.text.split())
            if item.index in targets and text and text != simplified[item.index].text:
                fixes[item.index] = text
        return fixes
    return None


def repair_and_recheck(
    provider: LLMProvider,
    original: list[OriginalSentence],
    simplified: list[SimplifiedSentence],
    sentences: list[CheckSentence],
    level: int,
    recheck: Recheck,
) -> list[CheckSentence]:
    """
    Returns the check result with accepted fixes applied. Anything that goes wrong
    (no problems, repair or re-check unavailable, fixes that don't pass) returns
    `sentences` unchanged.
    """
    targets = {s.index: s.reasons for s in sentences if s.status == "problem"}
    if not targets:
        return sentences
    proposed = request_repairs(provider, original, simplified, targets, level) or {}
    fixes = {i: t for i, t in proposed.items() if not too_long(t, simplified[i].text, level)}
    if not fixes:
        logger.info(
            "repair targets=%d proposed=%d too_long=%d accepted=0",
            len(targets),
            len(proposed),
            len(proposed) - len(fixes),
        )
        return sentences

    candidate = [
        SimplifiedSentence(text=fixes.get(i, s.text), sourceIds=s.sourceIds)
        for i, s in enumerate(simplified)
    ]
    rechecked, judge = recheck(candidate)
    if judge != "llm":
        logger.warning("repair re-check had no judge; keeping the original sentences")
        return sentences

    # A fix must not make a related sentence worse (e.g. a detail moved out of it). Only
    # sentences sharing a source with a fix can be affected; changes elsewhere are judge
    # noise, and those sentences keep their first verdict anyway.
    fixed_sources = {sid for i in fixes for sid in simplified[i].sourceIds}
    for i, (old, new) in enumerate(zip(sentences, rechecked, strict=True)):
        related = not fixed_sources.isdisjoint(simplified[i].sourceIds)
        if i not in fixes and related and STATUS_RANK[new.status] > STATUS_RANK[old.status]:
            logger.info("repair rejected: a related sentence got worse")
            return sentences

    result = list(sentences)
    still_problem = 0
    for i, new_text in fixes.items():
        after = rechecked[i]
        if after.status == "problem":
            still_problem += 1  # includes any problem-level rule finding
            continue
        result[i] = after.model_copy(
            update={
                "index": i,
                "repair": Repair(
                    text=new_text, previous=simplified[i].text, fixed=sentences[i].reasons
                ),
            }
        )
    logger.info(
        "repair targets=%d proposed=%d too_long=%d still_problem=%d accepted=%d",
        len(targets),
        len(proposed),
        len(proposed) - len(fixes),
        still_problem,
        len(fixes) - still_problem,
    )
    return result
