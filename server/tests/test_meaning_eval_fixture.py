"""Keeps the hand-labelled meaning-check evaluation set well-formed and balanced."""

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "meaning_eval.json"
ERROR_TYPES = {"negation", "number", "added", "hedge", "condition", "name"}


def load_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return cases


def test_every_case_has_the_expected_shape() -> None:
    for case in load_cases():
        assert set(case) == {"id", "source", "simplified", "label", "error_type", "note"}, case
        assert isinstance(case["source"], list) and case["source"], case["id"]
        assert all(isinstance(s, str) and s.strip() for s in case["source"]), case["id"]
        assert isinstance(case["simplified"], str) and case["simplified"].strip(), case["id"]
        assert case["note"].strip(), case["id"]
        if case["label"] == "faithful":
            assert case["error_type"] is None, case["id"]
        else:
            assert case["label"] == "error", case["id"]
            assert case["error_type"] in ERROR_TYPES, case["id"]


def test_ids_are_unique() -> None:
    ids = [c["id"] for c in load_cases()]
    assert len(ids) == len(set(ids))


def test_set_is_balanced() -> None:
    cases = load_cases()
    labels = Counter(c["label"] for c in cases)
    types = Counter(c["error_type"] for c in cases if c["label"] == "error")
    assert len(cases) >= 40
    assert labels["faithful"] >= 15
    assert labels["error"] >= 25
    # Every error type is represented at least twice.
    assert set(types) == ERROR_TYPES
    assert min(types.values()) >= 2


@pytest.mark.parametrize("case", load_cases(), ids=lambda c: c["id"])
def test_simplified_differs_from_source(case: dict[str, Any]) -> None:
    assert case["simplified"] != " ".join(case["source"])
