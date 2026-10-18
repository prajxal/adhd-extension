import pytest

from app.meaning.rules import RuleFinding, check_passage
from app.schemas import OriginalSentence, SimplifiedSentence
from tests.meaning_eval import load_cases, score


def run(sources: list[str], *simplified: tuple[str, list[int]]) -> list[list[RuleFinding]]:
    original = [OriginalSentence(id=i, text=t) for i, t in enumerate(sources, 1)]
    return check_passage(
        original, [SimplifiedSentence(text=t, sourceIds=ids) for t, ids in simplified]
    )


def rules(findings: list[RuleFinding]) -> set[str]:
    return {f.rule for f in findings}


# ---- numbers ----


def test_changed_number_is_a_problem() -> None:
    [findings] = run(["Turnout fell by 12.5%."], ("Turnout fell by 15%.", [1]))
    assert rules(findings) == {"number"}
    assert findings[0].severity == "problem"
    assert '"15%" isn\'t in the original' in findings[0].reason
    assert '"12.5%" from the original is missing' in findings[0].reason


def test_number_kept_across_split_sentences_is_fine() -> None:
    out = run(
        ["The trial had 120 adults and lasted 6 months."],
        ("The trial had 120 adults.", [1]),
        ("It lasted 6 months.", [1]),
    )
    assert out == [[], []]


def test_dropped_number_is_reported_once_on_the_first_mapped_sentence() -> None:
    out = run(
        ["Refunds are possible within 30 days of purchase."],
        ("You can get a refund.", [1]),
        ("Keep your receipt.", [1]),
    )
    assert rules(out[0]) >= {"number"}
    assert "number" not in rules(out[1])


def test_number_inside_a_bigger_number_does_not_count() -> None:
    [findings] = run(["The fine is $500."], ("The fine is $5,000.", [1]))
    assert rules(findings) == {"number"}


def test_percent_word_matches_percent_sign() -> None:
    [findings] = run(["Attendance fell by 12.5%."], ("Attendance went down by 12.5 percent.", [1]))
    assert "number" not in rules(findings)


def test_citation_markers_are_not_numbers() -> None:
    [findings] = run(
        ["ADHD[1] is a neurodevelopmental disorder.[8]"], ("ADHD is a brain disorder.", [1])
    )
    assert "number" not in rules(findings)


# ---- negation ----


@pytest.mark.parametrize(
    ("source", "simplified"),
    [
        ("The vaccine is not approved for children.", "The vaccine is approved for children."),
        ("Tenants can't be evicted in winter.", "Tenants can be evicted in winter."),
        ("The study found no link.", "The study found a link."),
    ],
)
def test_lost_negation_is_a_problem(source: str, simplified: str) -> None:
    [findings] = run([source], (simplified, [1]))
    assert rules(findings) == {"negation"}
    assert findings[0].severity == "problem"


def test_added_negation_is_a_problem() -> None:
    [findings] = run(["The water is safe to drink."], ("The water is not safe to drink.", [1]))
    assert rules(findings) == {"negation"}
    assert "Adds a negation" in findings[0].reason


@pytest.mark.parametrize(
    ("source", "simplified"),
    [
        ("The regulator refused the merger.", "The regulator did not allow the merger."),
        ("There was insufficient consultation.", "There was not enough consultation."),
        ("Neither the mayor nor her deputy came.", "The mayor and her deputy both missed it."),
        ("Officials did not rule out delays.", "Officials said delays are not impossible."),
    ],
)
def test_implied_negatives_count_as_negation(source: str, simplified: str) -> None:
    [findings] = run([source], (simplified, [1]))
    assert "negation" not in rules(findings)


# ---- hedging ----


def test_lost_hedge_is_a_check() -> None:
    [findings] = run(["The drug may slow memory loss."], ("The drug slows memory loss.", [1]))
    assert rules(findings) == {"hedge"}
    assert findings[0].severity == "check"


def test_hedge_kept_with_a_different_word_is_fine() -> None:
    [findings] = run(
        ["Approximately 5% of children are affected."], ("About 5% of children have it.", [1])
    )
    assert findings == []


# ---- names ----


def test_new_capitalised_name_is_a_check() -> None:
    [findings] = run(
        ["Researchers at Stanford University led it."],
        ("Researchers at Harvard University led it.", [1]),
    )
    assert rules(findings) == {"name"}
    assert findings[0].severity == "check"
    assert '"Harvard"' in findings[0].reason


def test_first_word_and_known_names_are_ignored() -> None:
    [findings] = run(
        ["Power went out in Kent on Tuesday."], ("On Tuesday, power went out in Kent.", [1])
    )
    assert findings == []


# ---- documented limitations (known false positives / misses) ----


def test_known_false_positive_double_negative() -> None:
    """'not unreasonable' → 'reasonable' keeps the meaning, but the rule sees a lost "not"."""
    [findings] = run(["The fee is not unreasonable."], ("The fee is reasonable.", [1]))
    assert rules(findings) == {"negation"}


def test_changed_month_is_caught_by_the_name_rule() -> None:
    """Month names are capitalised, so March → May shows up as a new name."""
    [findings] = run(["The vote moved to March 2025."], ("The vote moved to May 2025.", [1]))
    assert rules(findings) == {"name"}


def test_known_miss_dropped_condition() -> None:
    """A dropped "only if" has no number, negation or name to anchor on: left to the judge."""
    [findings] = run(
        ["Students may leave early only if a parent signs the form."],
        ("Students may leave early.", [1]),
    )
    assert findings == []


# ---- evaluation set ----


def test_rules_on_evaluation_set(capsys: pytest.CaptureFixture[str]) -> None:
    cases = load_cases()
    result = score(lambda c: any(check_passage(c.original, [c.simplified])[0]), cases)
    with capsys.disabled():
        print(f"\nRules only on {len(cases)} cases: {result.summary()}")
    # Regression floors, set from the measured scores. The judge (M3) covers the rest.
    assert result.recall >= 0.75
    assert result.false_flag_rate <= 0.10
