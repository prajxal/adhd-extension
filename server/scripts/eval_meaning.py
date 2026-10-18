"""Scores the meaning check (rules / judge / combined) on the labelled set with real models.

Run from /server:  PYTHONPATH=. .venv/bin/python scripts/eval_meaning.py model-a [model-b ...]
Cases are sent to the judge in batches of 10 (each batch laid out like one passage) to save quota.
"""

import random
import sys
import time

from app.config import get_settings
from app.llm.gemini import GeminiProvider
from app.meaning.check import combine
from app.meaning.judge import Verdict, run_judge
from app.meaning.rules import check_passage
from app.schemas import OriginalSentence, SimplifiedSentence
from tests.meaning_eval import EvalCase, load_cases, score

BATCH = 10


def judge_batch(provider: GeminiProvider, batch: list[EvalCase]) -> list[Verdict] | None:
    original: list[OriginalSentence] = []
    simplified: list[SimplifiedSentence] = []
    for case in batch:
        offset = len(original)
        original += [OriginalSentence(id=s.id + offset, text=s.text) for s in case.original]
        simplified.append(
            SimplifiedSentence(
                text=case.simplified.text, sourceIds=[i + offset for i in case.simplified.sourceIds]
            )
        )
    return run_judge(provider, original, simplified)


def main() -> None:
    cases = load_cases()
    random.Random(7).shuffle(cases)
    rules = {c.id: check_passage(c.original, [c.simplified])[0] for c in cases}
    print(f"rules only     {score(lambda c: bool(rules[c.id]), cases).summary()}\n")

    for model in sys.argv[1:]:
        provider = GeminiProvider(get_settings().gemini_api_key, model, timeout_s=60)
        verdicts: dict[str, Verdict] = {}
        started = time.perf_counter()
        failed = 0
        for start in range(0, len(cases), BATCH):
            batch = cases[start : start + BATCH]
            result = judge_batch(provider, batch)
            if result is None:
                failed += 1
                continue
            verdicts.update({c.id: v for c, v in zip(batch, result, strict=True)})
        seconds = time.perf_counter() - started
        if failed:
            print(f"{model}: {failed} of {(len(cases) + BATCH - 1) // BATCH} batches failed")
        judged = [c for c in cases if c.id in verdicts]
        if not judged:
            print(f"{model}: no answers ({seconds:.0f}s)\n")
            continue
        judge_only = score(lambda c, v=verdicts: v[c.id].label != "faithful", judged)
        combined = score(lambda c, v=verdicts: combine(rules[c.id], v[c.id]).status != "ok", judged)
        print(f"{model} ({len(judged)} cases, {seconds:.0f}s)")
        print(f"  judge only   {judge_only.summary()}")
        print(f"  combined     {combined.summary()}")
        for case in judged:
            v = verdicts[case.id]
            if (v.label != "faithful") != case.is_error:
                kind = "MISS" if case.is_error else "FALSE"
                print(f"    judge {kind} {case.id}: {v.label} {v.reasons}")
        print()


if __name__ == "__main__":
    main()
