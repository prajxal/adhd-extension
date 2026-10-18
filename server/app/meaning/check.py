import hashlib
import time
from typing import Literal

from app.cache import ResponseCache
from app.llm.base import LLMProvider
from app.logging_utils import logger, text_fingerprint
from app.meaning.judge import JUDGE_PROMPT_VERSION, Verdict, run_judge
from app.meaning.repair import REPAIR_PROMPT_VERSION, repair_and_recheck
from app.meaning.rules import RuleFinding, check_passage
from app.pipeline import SimplifyService
from app.schemas import (
    CheckResponse,
    CheckSentence,
    CheckSummary,
    OriginalSentence,
    SimplifiedSentence,
    Status,
    normalise_whitespace,
)

MeaningCheckMode = Literal["llm", "rules", "off"]


class NotSimplifiedError(Exception):
    """/check was called for text and level that /simplify hasn't produced."""


def combine(findings: list[RuleFinding], verdict: Verdict | None) -> CheckSentence:
    """One sentence's status from its rule findings and (optional) judge verdict."""
    judge = verdict.label if verdict else "faithful"
    if judge in ("changed", "added") or any(f.severity == "problem" for f in findings):
        status: Status = "problem"
    elif judge == "minor_loss" or findings:
        status = "check"
    else:
        status = "ok"
    reasons = [f.reason for f in findings]
    if verdict and verdict.label != "faithful":
        reasons += [r for r in verdict.reasons if r not in reasons]
    return CheckSentence(index=0, status=status, reasons=reasons)


def check_meaning(
    original: list[OriginalSentence],
    simplified: list[SimplifiedSentence],
    provider: LLMProvider | None,
) -> tuple[list[CheckSentence], Literal["llm", "rules"]]:
    """Rules always run; the judge runs when a provider is given and answers."""
    findings = check_passage(original, simplified)
    verdicts = run_judge(provider, original, simplified) if provider else None
    sentences = [
        combine(f, verdicts[i] if verdicts else None).model_copy(update={"index": i})
        for i, f in enumerate(findings)
    ]
    return sentences, "llm" if verdicts is not None else "rules"


def summarise(sentences: list[CheckSentence]) -> CheckSummary:
    return CheckSummary(
        ok=sum(s.status == "ok" for s in sentences),
        check=sum(s.status == "check" for s in sentences),
        problem=sum(s.status == "problem" for s in sentences),
        repaired=sum(s.repair is not None for s in sentences),
    )


class CheckService:
    def __init__(
        self,
        simplify: SimplifyService,
        provider: LLMProvider,
        cache: ResponseCache,
        mode: MeaningCheckMode,
        repair: bool = True,
    ) -> None:
        self._simplify = simplify
        self._provider = provider
        self._cache = cache
        self.mode = mode
        self.repair = repair and mode == "llm"

    def check(self, text: str, level: int) -> CheckResponse:
        started = time.perf_counter()
        simplified = self._simplify.cached(text, level)
        if simplified is None:
            raise NotSimplifiedError
        raw = "\x1f".join(
            [
                self._simplify.key_for(text, level),
                JUDGE_PROMPT_VERSION,
                self.mode,
                REPAIR_PROMPT_VERSION if self.repair else "no-repair",
            ]
        )
        key = hashlib.sha256(raw.encode("utf-8")).hexdigest()

        hit = self._cache.get(key)
        if hit is not None:
            response = CheckResponse.model_validate_json(hit).model_copy(update={"cached": True})
        else:
            provider = self._provider if self.mode == "llm" else None
            original = simplified.original
            sentences, judge = check_meaning(original, simplified.simplified, provider)
            if self.repair and judge == "llm":
                sentences = repair_and_recheck(
                    self._provider,
                    original,
                    simplified.simplified,
                    sentences,
                    level,
                    lambda candidate: check_meaning(original, candidate, self._provider),
                )
            response = CheckResponse(
                sentences=sentences, summary=summarise(sentences), judge=judge, cached=False
            )
            # Don't keep a rules-only fallback when the judge was meant to run: it may be back soon.
            if not (self.mode == "llm" and judge == "rules"):
                self._cache.put(key, response.model_dump_json())

        logger.info(
            "check %s level=%d judge=%s ok=%d check=%d problem=%d repaired=%d cached=%s ms=%d",
            text_fingerprint(normalise_whitespace(text)),
            level,
            response.judge,
            response.summary.ok,
            response.summary.check,
            response.summary.problem,
            response.summary.repaired,
            response.cached,
            (time.perf_counter() - started) * 1000,
        )
        return response
