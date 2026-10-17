"""
LLM judge for the meaning check.

The judge sees the whole passage at once and answers two questions:
- per simplified sentence: does it say anything wrong or unsupported?
- per original sentence: did the simplified text, taken together, drop something important?
Splitting one source across several simplified sentences is normal, so "missing details"
is only judged per source, never per fragment.
"""

from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.llm.base import LLMOutputError, LLMProvider, LLMProviderError
from app.logging_utils import logger
from app.schemas import OriginalSentence, SimplifiedSentence

JUDGE_PROMPT_VERSION = "v1"

JUDGE_SYSTEM_PROMPT = """\
You check whether a plain-language rewrite keeps the meaning of the original text.

You will get the ORIGINAL sentences numbered like [1], and the SIMPLIFIED sentences numbered like (0), each followed by the original sentences it comes from.

1. For every simplified sentence, give a label:
- faithful: says nothing that conflicts with or goes beyond its original sentences. Simpler words, splitting a sentence, and leaving details to other simplified sentences are all fine.
- changed: says something different from the original, for example a negation flipped or lost, a number, date, name or condition changed, or something stated as certain that the original only suggested (may, might, probably, about).
- added: states a fact, cause, opinion, advice or detail that is not in the original.

2. For every original sentence, look at all the simplified sentences that come from it together. If they leave out something important, add an omission:
- severity "major": the reader would get the meaning wrong, for example a negation, condition (if, unless, only if), number, date, name or limit is missing.
- severity "minor": a small detail or qualifier is missing, but the main meaning survives.
Do not report an omission when the detail appears in any of those simplified sentences.

Keep every reason under 12 words, in plain English, and name the specific word or fact.
Return only JSON that matches the schema."""


class JudgedSentence(BaseModel):
    index: int
    label: Literal["faithful", "changed", "added"]
    reason: str = ""


class Omission(BaseModel):
    sourceId: int
    severity: Literal["minor", "major"]
    reason: str


class JudgeOutput(BaseModel):
    sentences: list[JudgedSentence]
    omissions: list[Omission] = Field(default_factory=list)


JudgeLabel = Literal["faithful", "minor_loss", "changed", "added"]


class Verdict(BaseModel):
    """The judge's answer for one simplified sentence, in the spec's four labels."""

    label: JudgeLabel = "faithful"
    reasons: list[str] = Field(default_factory=list)


SEVERITY_ORDER: dict[JudgeLabel, int] = {"faithful": 0, "minor_loss": 1, "added": 2, "changed": 3}


def build_judge_input(
    original: list[OriginalSentence], simplified: list[SimplifiedSentence]
) -> str:
    lines = ["ORIGINAL:"]
    lines += [f"[{s.id}] {s.text}" for s in original]
    lines.append("")
    lines.append("SIMPLIFIED:")
    for index, sentence in enumerate(simplified):
        sources = ", ".join(f"[{i}]" for i in sentence.sourceIds)
        lines.append(f"({index}) {sentence.text}  <- from {sources}")
    return "\n".join(lines)


def _clean_reason(reason: str) -> str:
    reason = " ".join(reason.split())
    return reason[:1].upper() + reason[1:] if reason else reason


def to_verdicts(
    output: JudgeOutput, original: list[OriginalSentence], simplified: list[SimplifiedSentence]
) -> list[Verdict]:
    """Maps the judge's answer onto each simplified sentence, ignoring unknown indexes/ids."""
    verdicts = [Verdict() for _ in simplified]

    def raise_to(index: int, label: JudgeLabel, reason: str) -> None:
        verdict = verdicts[index]
        if SEVERITY_ORDER[label] > SEVERITY_ORDER[verdict.label]:
            verdict.label = label
        cleaned = _clean_reason(reason)
        if cleaned and cleaned not in verdict.reasons:
            verdict.reasons.append(cleaned)

    for item in output.sentences:
        if 0 <= item.index < len(simplified) and item.label != "faithful":
            raise_to(item.index, item.label, item.reason or f"Judge: {item.label}")

    first_mapped: dict[int, int] = {}
    for index, sentence in enumerate(simplified):
        for sid in sentence.sourceIds:
            first_mapped.setdefault(sid, index)
    valid_ids = {s.id for s in original}
    for omission in output.omissions:
        index = first_mapped.get(omission.sourceId)
        if omission.sourceId in valid_ids and index is not None:
            label: JudgeLabel = "changed" if omission.severity == "major" else "minor_loss"
            raise_to(index, label, omission.reason)
    return verdicts


def run_judge(
    provider: LLMProvider, original: list[OriginalSentence], simplified: list[SimplifiedSentence]
) -> list[Verdict] | None:
    """Returns one verdict per simplified sentence, or None if the judge couldn't answer."""
    user = build_judge_input(original, simplified)
    for attempt in (1, 2):
        try:
            output = provider.generate_json(JUDGE_SYSTEM_PROMPT, user, JudgeOutput)
            return to_verdicts(output, original, simplified)
        except (ValidationError, LLMOutputError):
            logger.warning("judge output invalid attempt=%d", attempt)
        except LLMProviderError as exc:
            logger.warning("judge unavailable: %s", exc)
            return None
    return None
