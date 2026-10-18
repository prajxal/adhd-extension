import logging
import time
from typing import Any

import pytest

from app.llm.base import LLMProviderError
from app.meaning.judge import JUDGE_SYSTEM_PROMPT
from app.ratelimit import RateLimiter
from tests.conftest import GOOD, TEXT, MakeClient, with_


def judge(*labels: str, omissions: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "sentences": [
            {"index": i, "label": label, "reason": f"judge says {label}"}
            for i, label in enumerate(labels)
        ],
        "omissions": omissions or [],
    }


ALL_FAITHFUL = judge("faithful", "faithful", "faithful")


def simplify_then_check(make_client: MakeClient, *responses: Any, **kwargs: Any) -> Any:
    client, provider = make_client(list(responses), **kwargs)
    assert client.post("/simplify", json={"text": TEXT, "level": 2}).status_code == 200
    return client, provider, client.post("/check", json={"text": TEXT, "level": 2})


def test_check_needs_a_simplified_result_first(make_client: MakeClient) -> None:
    client, provider = make_client([GOOD, ALL_FAITHFUL])
    response = client.post("/check", json={"text": TEXT, "level": 2})
    assert response.status_code == 409
    assert response.json()["detail"] == "Simplify this text first."
    assert provider.calls == []


def test_check_for_another_level_needs_its_own_simplify(make_client: MakeClient) -> None:
    client, _, _ = simplify_then_check(make_client, GOOD, ALL_FAITHFUL)
    assert client.post("/check", json={"text": TEXT, "level": 3}).status_code == 409


def test_all_faithful(make_client: MakeClient) -> None:
    _, provider, response = simplify_then_check(make_client, GOOD, ALL_FAITHFUL)
    body = response.json()
    assert response.status_code == 200
    assert body["judge"] == "llm"
    assert body["cached"] is False
    assert body["summary"] == {"ok": 3, "check": 0, "problem": 0, "repaired": 0}
    assert [s["status"] for s in body["sentences"]] == ["ok", "ok", "ok"]
    assert [s["index"] for s in body["sentences"]] == [0, 1, 2]
    assert provider.calls[1][0] == JUDGE_SYSTEM_PROMPT  # second LLM call is the judge


def test_judge_changed_is_a_problem_with_its_reason(make_client: MakeClient) -> None:
    _, _, response = simplify_then_check(
        make_client, GOOD, judge("faithful", "changed", "faithful")
    )
    sentence = response.json()["sentences"][1]
    assert sentence["status"] == "problem"
    assert sentence["reasons"] == ["Judge says changed"]


def test_rule_problem_stands_even_when_judge_says_faithful(make_client: MakeClient) -> None:
    changed = [dict(s) for s in GOOD["simplified"]]
    changed[1] = {"text": "15% fewer people voted than the year before.", "sourceIds": [2]}
    _, _, response = simplify_then_check(make_client, with_(simplified=changed), ALL_FAITHFUL)
    sentence = response.json()["sentences"][1]
    assert sentence["status"] == "problem"
    assert sentence["reasons"][0].startswith("Number check:")


def test_minor_omission_is_a_check_on_the_mapped_sentence(make_client: MakeClient) -> None:
    omission = {"sourceId": 3, "severity": "minor", "reason": "drops 'the reason for the delay'"}
    _, _, response = simplify_then_check(make_client, GOOD, judge(omissions=[omission]))
    body = response.json()
    assert body["sentences"][2]["status"] == "check"
    assert body["sentences"][2]["reasons"] == ["Drops 'the reason for the delay'"]
    assert body["summary"] == {"ok": 2, "check": 1, "problem": 0, "repaired": 0}


def test_invalid_judge_output_falls_back_to_rules_and_is_not_cached(
    make_client: MakeClient,
) -> None:
    client, provider, response = simplify_then_check(make_client, GOOD, "{oops")
    assert response.json()["judge"] == "rules"
    assert response.json()["summary"] == {"ok": 3, "check": 0, "problem": 0, "repaired": 0}
    calls = len(provider.calls)
    again = client.post("/check", json={"text": TEXT, "level": 2}).json()
    assert again["cached"] is False  # the judge is tried again next time
    assert len(provider.calls) > calls


def test_provider_down_falls_back_to_rules(make_client: MakeClient) -> None:
    _, _, response = simplify_then_check(
        make_client,
        GOOD,
        LLMProviderError("All models failed; last: Gemini API error (status 429)"),
    )
    assert response.status_code == 200
    assert response.json()["judge"] == "rules"


def test_second_check_is_cached_and_fast(make_client: MakeClient) -> None:
    client, provider, first = simplify_then_check(make_client, GOOD, ALL_FAITHFUL)
    calls = len(provider.calls)
    started = time.perf_counter()
    second = client.post("/check", json={"text": TEXT, "level": 2}).json()
    elapsed_ms = (time.perf_counter() - started) * 1000
    assert second["cached"] is True
    assert elapsed_ms < 50
    assert len(provider.calls) == calls
    assert {**second, "cached": False} == first.json()


def test_rules_mode_makes_no_judge_call(make_client: MakeClient) -> None:
    client, provider, response = simplify_then_check(make_client, GOOD, mode="rules")
    assert response.json()["judge"] == "rules"
    assert len(provider.calls) == 1  # only /simplify used the LLM
    assert client.post("/check", json={"text": TEXT, "level": 2}).json()["cached"] is True


def test_off_mode_returns_404(make_client: MakeClient) -> None:
    _, _, response = simplify_then_check(make_client, GOOD, mode="off")
    assert response.status_code == 404


def test_bad_input_gives_400(make_client: MakeClient) -> None:
    client, _ = make_client()
    assert client.post("/check", json={"text": "too short", "level": 2}).status_code == 400
    assert client.post("/check", json={"text": TEXT, "level": 9}).status_code == 400


def test_rate_limit_is_shared_with_simplify(make_client: MakeClient) -> None:
    client, _ = make_client([GOOD, ALL_FAITHFUL], limiter=RateLimiter(limit=3, window_s=60))
    codes = [
        client.post("/simplify", json={"text": TEXT}).status_code,
        client.post("/check", json={"text": TEXT}).status_code,
        client.post("/check", json={"text": TEXT}).status_code,
        client.post("/check", json={"text": TEXT}).status_code,
    ]
    assert codes == [200, 200, 200, 429]


def test_check_logs_never_contain_user_text(
    make_client: MakeClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    client, _, _ = simplify_then_check(make_client, GOOD, "{oops")  # judge fails → rules
    client.post("/check", json={"text": TEXT, "level": 2})
    client.post("/check", json={"text": TEXT, "level": 3})  # 409
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "check len=" in logged
    for fragment in ["committee", "postponed", "Turnout", "Officials", "moved the vote"]:
        assert fragment not in logged, fragment
