"""Measures auto-repair on the error cases of the labelled meaning-check set with real models.

Run from /server:  PYTHONPATH=. .venv/bin/python scripts/eval_repair.py model-a [model-b ...]
Cases go in batches of 10 laid out like one passage: per batch one judge call, one repair
call and one re-check judge call.
"""

import random
import sys
import time

from app.config import get_settings
from app.llm.gemini import GeminiProvider
from app.meaning.check import check_meaning
from app.meaning.repair import repair_and_recheck
from app.meaning.rules import check_passage
from app.schemas import OriginalSentence, SimplifiedSentence
from tests.meaning_eval import EvalCase, load_cases

BATCH = 10
TARGET_ACCEPTED = 0.60


def passage(batch: list[EvalCase]) -> tuple[list[OriginalSentence], list[SimplifiedSentence]]:
    original: list[OriginalSentence] = []
    simplified: list[SimplifiedSentence] = []
    for case in batch:
        offset = len(original)
        original += [OriginalSentence(id=s.id + offset, text=s.text) for s in case.original]
        ids = [i + offset for i in case.simplified.sourceIds]
        simplified.append(SimplifiedSentence(text=case.simplified.text, sourceIds=ids))
    return original, simplified


def main() -> None:
    cases = [c for c in load_cases() if c.is_error]
    random.Random(7).shuffle(cases)
    for model in sys.argv[1:]:
        provider = GeminiProvider(get_settings().gemini_api_key, model, timeout_s=60)
        started = time.perf_counter()
        flagged = accepted = unsafe = 0
        reviewed: list[str] = []
        failed_batches = 0
        for start in range(0, len(cases), BATCH):
            batch = cases[start : start + BATCH]
            original, simplified = passage(batch)
            sentences, judge = check_meaning(original, simplified, provider)
            if judge != "llm":
                failed_batches += 1
                continue
            result = repair_and_recheck(
                provider,
                original,
                simplified,
                sentences,
                2,
                lambda c, o=original, p=provider: check_meaning(o, c, p),
            )
            for case, before, after in zip(batch, sentences, result, strict=True):
                if before.status != "problem":
                    continue
                flagged += 1
                if after.repair is None:
                    reviewed.append(f"  kept   {case.id}: {case.simplified.text}")
                    continue
                accepted += 1
                # Independent backstop: do the rules alone see a problem in the fix?
                fixed = SimplifiedSentence(
                    text=after.repair.text, sourceIds=case.simplified.sourceIds
                )
                rule_findings = check_passage(case.original, [fixed])[0]
                if any(f.severity == "problem" for f in rule_findings):
                    unsafe += 1
                sources = " ".join(s.text for s in case.original)
                reviewed.append(
                    f"  FIXED  {case.id} ({case.error_type})\n"
                    f"         source: {sources}\n"
                    f"         before: {after.repair.previous}\n"
                    f"         after:  {after.repair.text}  [{after.status}]"
                )
        seconds = time.perf_counter() - started
        rate = accepted / flagged if flagged else 0.0
        verdict = "meets" if rate >= TARGET_ACCEPTED and unsafe == 0 else "misses"
        print(
            f"{model} ({seconds:.0f}s, {failed_batches} failed batches): problems {flagged}, "
            f"fixes accepted {accepted} ({rate:.0%}), accepted with a rule problem {unsafe} "
            f"-> {verdict} target (>= {TARGET_ACCEPTED:.0%}, 0 unsafe)"
        )
        print("\n".join(reviewed), "\n")


if __name__ == "__main__":
    main()
