"""Loads the labelled meaning-check set and scores a checker against it."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.schemas import OriginalSentence, SimplifiedSentence

FIXTURE = Path(__file__).parent / "fixtures" / "meaning_eval.json"


@dataclass(frozen=True)
class EvalCase:
    id: str
    original: list[OriginalSentence]
    simplified: SimplifiedSentence
    is_error: bool
    error_type: str | None


@dataclass
class Score:
    errors: int = 0
    caught: int = 0
    faithful: int = 0
    false_flags: int = 0
    missed: list[str] = field(default_factory=list)
    false_flagged: list[str] = field(default_factory=list)
    by_type: dict[str, tuple[int, int]] = field(default_factory=dict)  # type -> (caught, total)

    @property
    def recall(self) -> float:
        return self.caught / self.errors if self.errors else 0.0

    @property
    def false_flag_rate(self) -> float:
        return self.false_flags / self.faithful if self.faithful else 0.0

    @property
    def precision(self) -> float:
        flagged = self.caught + self.false_flags
        return self.caught / flagged if flagged else 0.0

    def summary(self) -> str:
        types = ", ".join(f"{t} {c}/{n}" for t, (c, n) in sorted(self.by_type.items()))
        return (
            f"recall {self.caught}/{self.errors} ({self.recall:.0%}), "
            f"false flags {self.false_flags}/{self.faithful} ({self.false_flag_rate:.0%}), "
            f"precision {self.precision:.0%} | {types}\n"
            f"  missed: {self.missed}\n  false-flagged: {self.false_flagged}"
        )


def load_cases() -> list[EvalCase]:
    raw: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    cases = []
    for item in raw:
        original = [OriginalSentence(id=i, text=t) for i, t in enumerate(item["source"], 1)]
        simplified = SimplifiedSentence(text=item["simplified"], sourceIds=[s.id for s in original])
        cases.append(
            EvalCase(
                id=item["id"],
                original=original,
                simplified=simplified,
                is_error=item["label"] == "error",
                error_type=item["error_type"],
            )
        )
    return cases


def score(flags: Callable[[EvalCase], bool], cases: list[EvalCase]) -> Score:
    """`flags(case)` returns True if the checker flags the case (status check or problem)."""
    result = Score()
    for case in cases:
        flagged = flags(case)
        if case.is_error:
            result.errors += 1
            assert case.error_type is not None
            caught, total = result.by_type.get(case.error_type, (0, 0))
            result.by_type[case.error_type] = (caught + int(flagged), total + 1)
            if flagged:
                result.caught += 1
            else:
                result.missed.append(case.id)
        else:
            result.faithful += 1
            if flagged:
                result.false_flags += 1
                result.false_flagged.append(case.id)
    return result
