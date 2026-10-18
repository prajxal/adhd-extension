from typing import Any

from app.llm.base import LLMProviderError
from app.meaning.repair import REPAIR_SYSTEM_PROMPT, build_repair_input, too_long
from app.schemas import OriginalSentence, SimplifiedSentence
from tests.conftest import GOOD, TEXT, MakeClient, with_

# Sentence 2 loses the source's "not": the number/negation rules mark it a problem.
BROKEN = with_(
    simplified=[
        *GOOD["simplified"][:2],
        {"text": "Officials explained why.", "sourceIds": [3]},
    ]
)


def judge(*labels: str) -> dict[str, Any]:
    return {
        "sentences": [
            {"index": i, "label": label, "reason": label} for i, label in enumerate(labels)
        ],
        "omissions": [],
    }


FAITHFUL = judge("faithful", "faithful", "faithful")


def fix(index: int, text: str) -> dict[str, Any]:
    return {"repairs": [{"index": index, "text": text}]}


def run(make_client: MakeClient, *responses: Any, **kwargs: Any) -> tuple[dict[str, Any], int]:
    """simplify → check; returns the check body and how many LLM calls were made."""
    client, provider = make_client(list(responses), **kwargs)
    assert client.post("/simplify", json={"text": TEXT, "level": 2}).status_code == 200
    body = client.post("/check", json={"text": TEXT, "level": 2}).json()
    return body, len(provider.calls)


def test_accepted_fix_replaces_the_sentence(make_client: MakeClient) -> None:
    body, calls = run(make_client, BROKEN, FAITHFUL, fix(2, "Officials did not say why."), FAITHFUL)
    sentence = body["sentences"][2]
    assert sentence["status"] == "ok"
    assert sentence["reasons"] == []
    assert sentence["repair"] == {
        "text": "Officials did not say why.",
        "previous": "Officials explained why.",
        "fixed": ['Negation may be lost (original says "not").'],
    }
    assert body["summary"] == {"ok": 3, "check": 0, "problem": 0, "repaired": 1}
    assert calls == 4  # simplify, judge, repair, re-judge


def test_fix_that_still_fails_the_rules_is_rejected(make_client: MakeClient) -> None:
    body, _ = run(make_client, BROKEN, FAITHFUL, fix(2, "Officials gave a reason."), FAITHFUL)
    sentence = body["sentences"][2]
    assert sentence["status"] == "problem"
    assert sentence["repair"] is None
    assert body["summary"]["repaired"] == 0


def test_fix_that_adds_a_new_number_is_rejected(make_client: MakeClient) -> None:
    body, _ = run(
        make_client, BROKEN, FAITHFUL, fix(2, "Officials did not say why in 2024."), FAITHFUL
    )
    assert body["sentences"][2]["status"] == "problem"
    assert body["sentences"][2]["repair"] is None


def test_fix_the_judge_still_calls_changed_is_rejected(make_client: MakeClient) -> None:
    body, _ = run(
        make_client,
        BROKEN,
        FAITHFUL,
        fix(2, "Officials did not say why."),
        judge("faithful", "faithful", "changed"),
    )
    assert body["sentences"][2]["repair"] is None


# Two sentences from source [3]: the lost "not" is reported on the first of them.
SPLIT = with_(
    simplified=[
        *GOOD["simplified"][:2],
        {"text": "Officials explained why.", "sourceIds": [3]},
        {"text": "This was about the delay.", "sourceIds": [3]},
    ]
)
FAITHFUL_4 = judge("faithful", "faithful", "faithful", "faithful")


def test_fix_is_rejected_when_a_related_sentence_gets_worse(make_client: MakeClient) -> None:
    body, _ = run(
        make_client,
        SPLIT,
        FAITHFUL_4,
        fix(2, "Officials did not say why."),
        judge("faithful", "faithful", "faithful", "changed"),  # same source as the fix
    )
    assert body["sentences"][2]["status"] == "problem"
    assert body["sentences"][2]["repair"] is None
    assert body["sentences"][3]["status"] == "ok"


def test_unrelated_sentence_changing_does_not_block_a_fix(make_client: MakeClient) -> None:
    body, _ = run(
        make_client,
        SPLIT,
        FAITHFUL_4,
        fix(2, "Officials did not say why."),
        judge("changed", "faithful", "faithful", "faithful"),  # different source: judge noise
    )
    assert body["sentences"][2]["repair"] is not None
    assert body["sentences"][0]["status"] == "ok"  # keeps its first verdict


def test_repair_call_failing_returns_the_plain_check(make_client: MakeClient) -> None:
    body, _ = run(make_client, BROKEN, FAITHFUL, "{oops", "{oops")
    assert body["judge"] == "llm"
    assert body["sentences"][2]["status"] == "problem"
    assert body["summary"]["repaired"] == 0


def test_provider_down_during_repair_returns_the_plain_check(make_client: MakeClient) -> None:
    body, _ = run(make_client, BROKEN, FAITHFUL, LLMProviderError("status 429"))
    assert body["sentences"][2]["status"] == "problem"


def test_recheck_without_the_judge_keeps_the_original(make_client: MakeClient) -> None:
    body, _ = run(
        make_client,
        BROKEN,
        FAITHFUL,
        fix(2, "Officials did not say why."),
        LLMProviderError("status 503"),
    )
    assert body["sentences"][2]["repair"] is None
    assert body["judge"] == "llm"  # the first, real check still stands


def test_unknown_index_or_unchanged_text_is_ignored(make_client: MakeClient) -> None:
    repairs = {
        "repairs": [
            {"index": 0, "text": "Not a target."},
            {"index": 2, "text": "Officials explained why."},
            {"index": 9, "text": "Out of range."},
        ]
    }
    body, calls = run(make_client, BROKEN, FAITHFUL, repairs)
    assert body["sentences"][2]["repair"] is None
    assert calls == 3  # nothing usable came back, so no re-check


def test_no_problems_means_no_repair_call(make_client: MakeClient) -> None:
    _, calls = run(make_client, GOOD, FAITHFUL)
    assert calls == 2


def test_repair_off_means_no_repair_call(make_client: MakeClient) -> None:
    body, calls = run(make_client, BROKEN, FAITHFUL, repair=False)
    assert calls == 2
    assert body["sentences"][2]["status"] == "problem"


def test_rules_mode_never_repairs(make_client: MakeClient) -> None:
    body, calls = run(make_client, BROKEN, mode="rules")
    assert calls == 1
    assert body["sentences"][2]["repair"] is None


def test_repaired_result_is_cached(make_client: MakeClient) -> None:
    client, provider = make_client(
        [BROKEN, FAITHFUL, fix(2, "Officials did not say why."), FAITHFUL]
    )
    client.post("/simplify", json={"text": TEXT, "level": 2})
    first = client.post("/check", json={"text": TEXT, "level": 2}).json()
    calls = len(provider.calls)
    second = client.post("/check", json={"text": TEXT, "level": 2}).json()
    assert second["cached"] is True
    assert second["sentences"][2]["repair"] == first["sentences"][2]["repair"]
    assert len(provider.calls) == calls


def test_fix_that_re_expands_into_a_long_sentence_is_dropped(make_client: MakeClient) -> None:
    long_fix = (
        "Officials did not explain the reason for the delay to the committee, the press, "
        "the voters or anyone else who asked them about it."
    )
    body, calls = run(make_client, BROKEN, FAITHFUL, fix(2, long_fix))
    assert body["sentences"][2]["repair"] is None
    assert calls == 3  # dropped before the re-check


def test_too_long_limit() -> None:
    assert not too_long("one two three", "a b", 2)
    assert too_long(" ".join(["w"] * 21), "a b", 2)  # level 2: 15 + 5
    assert not too_long(" ".join(["w"] * 25), " ".join(["w"] * 20), 2)  # previous was long


def test_repair_input_lists_sources_and_reasons() -> None:
    original = [OriginalSentence(id=1, text="Officials did not explain the delay.")]
    simplified = [SimplifiedSentence(text="Officials explained the delay.", sourceIds=[1])]
    text = build_repair_input(original, simplified, {0: ["Negation may be lost."]})
    assert "[1] Officials did not explain the delay." in text
    assert "(0) Officials explained the delay.  <- from [1]" in text
    assert "Problems: Negation may be lost." in text


def test_repair_input_shows_what_sibling_sentences_already_cover() -> None:
    original = [
        OriginalSentence(id=1, text="The council did not rule out delays unless funding arrives."),
        OriginalSentence(id=2, text="Turnout fell."),
    ]
    simplified = [
        SimplifiedSentence(text="The council might have more delays.", sourceIds=[1]),
        SimplifiedSentence(text="Delays will happen unless money arrives.", sourceIds=[1]),
        SimplifiedSentence(text="Fewer people came.", sourceIds=[2]),
    ]
    text = build_repair_input(original, simplified, {1: ["Flipped the condition."]})
    assert (
        "Already covered by other sentences (do not repeat): The council might have more delays."
        in text
    )
    assert "Fewer people came." not in text  # different source


def test_repair_prompt_carries_the_level_rule() -> None:
    assert "{level_rule}" in REPAIR_SYSTEM_PROMPT
