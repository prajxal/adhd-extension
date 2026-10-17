import pytest

from app.llm.base import LLMProviderError
from app.llm.fake import FakeProvider
from app.meaning.check import check_meaning, combine
from app.meaning.judge import (
    JUDGE_SYSTEM_PROMPT,
    JudgeOutput,
    Verdict,
    build_judge_input,
    run_judge,
    to_verdicts,
)
from app.meaning.rules import RuleFinding
from app.schemas import OriginalSentence, SimplifiedSentence

ORIGINAL = [
    OriginalSentence(id=1, text="The trial had 120 adults and lasted 6 months."),
    OriginalSentence(id=2, text="Results were not significant."),
]
SIMPLIFIED = [
    SimplifiedSentence(text="The trial had 120 adults.", sourceIds=[1]),
    SimplifiedSentence(text="It lasted 6 months.", sourceIds=[1]),
    SimplifiedSentence(text="The results were not significant.", sourceIds=[2]),
]

PROBLEM = RuleFinding(rule="negation", severity="problem", reason="Negation may be lost.")
CHECK = RuleFinding(rule="hedge", severity="check", reason="May sound more certain.")


def test_judge_input_lists_originals_and_simplified_with_sources() -> None:
    text = build_judge_input(ORIGINAL, SIMPLIFIED)
    assert "[1] The trial had 120 adults and lasted 6 months." in text
    assert "(1) It lasted 6 months.  <- from [1]" in text
    assert text.index("ORIGINAL:") < text.index("SIMPLIFIED:")


def test_verdicts_map_labels_and_ignore_unknown_indexes() -> None:
    output = JudgeOutput.model_validate(
        {
            "sentences": [
                {"index": 0, "label": "faithful"},
                {"index": 2, "label": "added", "reason": "adds that results were 'surprising'"},
                {"index": 9, "label": "changed", "reason": "out of range"},
            ]
        }
    )
    verdicts = to_verdicts(output, ORIGINAL, SIMPLIFIED)
    assert [v.label for v in verdicts] == ["faithful", "faithful", "added"]
    assert verdicts[2].reasons == ["Adds that results were 'surprising'"]


@pytest.mark.parametrize(("severity", "label"), [("major", "changed"), ("minor", "minor_loss")])
def test_omission_lands_on_first_sentence_for_that_source(severity: str, label: str) -> None:
    output = JudgeOutput.model_validate(
        {
            "sentences": [],
            "omissions": [{"sourceId": 1, "severity": severity, "reason": "drops 'adults'"}],
        }
    )
    verdicts = to_verdicts(output, ORIGINAL, SIMPLIFIED)
    assert verdicts[0].label == label
    assert verdicts[1].label == "faithful"


def test_omission_for_unknown_source_is_ignored_and_worst_label_wins() -> None:
    output = JudgeOutput.model_validate(
        {
            "sentences": [{"index": 0, "label": "added", "reason": "adds 'healthy'"}],
            "omissions": [
                {"sourceId": 7, "severity": "major", "reason": "unknown source"},
                {"sourceId": 1, "severity": "minor", "reason": "drops a detail"},
            ],
        }
    )
    verdict = to_verdicts(output, ORIGINAL, SIMPLIFIED)[0]
    assert verdict.label == "added"  # added outranks minor_loss
    assert verdict.reasons == ["Adds 'healthy'", "Drops a detail"]


@pytest.mark.parametrize(
    ("findings", "verdict", "status"),
    [
        ([], None, "ok"),
        ([], Verdict(label="faithful"), "ok"),
        ([CHECK], None, "check"),
        ([], Verdict(label="minor_loss", reasons=["x"]), "check"),
        ([PROBLEM], Verdict(label="faithful"), "problem"),  # rules can't be overruled
        ([], Verdict(label="changed", reasons=["x"]), "problem"),
        ([CHECK], Verdict(label="added", reasons=["x"]), "problem"),
    ],
)
def test_combine_status_table(
    findings: list[RuleFinding], verdict: Verdict | None, status: str
) -> None:
    assert combine(findings, verdict).status == status


def test_combine_puts_rule_reasons_first_and_skips_faithful_reasons() -> None:
    result = combine([CHECK], Verdict(label="changed", reasons=["Flips 'not'"]))
    assert result.reasons == ["May sound more certain.", "Flips 'not'"]
    assert combine([], Verdict(label="faithful", reasons=["fine"])).reasons == []


def test_run_judge_retries_once_then_gives_up() -> None:
    good = {"sentences": [{"index": 0, "label": "faithful"}], "omissions": []}
    assert run_judge(FakeProvider(["{oops", good]), ORIGINAL, SIMPLIFIED) is not None
    assert run_judge(FakeProvider(["{oops", "{oops"]), ORIGINAL, SIMPLIFIED) is None


def test_run_judge_returns_none_when_provider_is_down() -> None:
    provider = FakeProvider([LLMProviderError("Gemini API error (status 503)")])
    assert run_judge(provider, ORIGINAL, SIMPLIFIED) is None
    assert len(provider.calls) == 1  # provider errors aren't retried here (the chain already was)


def test_check_meaning_with_fake_echo_judge_is_all_ok() -> None:
    provider = FakeProvider()
    sentences, judge = check_meaning(ORIGINAL, SIMPLIFIED, provider)
    assert judge == "llm"
    assert [s.status for s in sentences] == ["ok", "ok", "ok"]
    assert [s.index for s in sentences] == [0, 1, 2]
    assert provider.calls[0][0] == JUDGE_SYSTEM_PROMPT


def test_check_meaning_without_provider_is_rules_only() -> None:
    sentences, judge = check_meaning(
        ORIGINAL,
        [SimplifiedSentence(text="The results were significant.", sourceIds=[2])],
        None,
    )
    assert judge == "rules"
    assert sentences[0].status == "problem"
