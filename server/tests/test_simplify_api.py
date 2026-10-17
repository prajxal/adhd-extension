import logging
import time

import pytest

from app.llm.base import LLMProviderError
from app.ratelimit import RateLimiter
from tests.conftest import GOOD, TEXT, MakeClient


def test_same_request_twice_is_cached_and_fast(make_client: MakeClient) -> None:
    client, provider = make_client()
    first = client.post("/simplify", json={"text": TEXT, "level": 2}).json()

    started = time.perf_counter()
    second = client.post("/simplify", json={"text": TEXT, "level": 2}).json()
    elapsed_ms = (time.perf_counter() - started) * 1000

    assert first["cached"] is False
    assert second["cached"] is True
    assert elapsed_ms < 50
    assert len(provider.calls) == 1
    assert {**second, "cached": False} == first


def test_cache_key_includes_level_and_normalises_whitespace(make_client: MakeClient) -> None:
    client, provider = make_client()
    client.post("/simplify", json={"text": TEXT, "level": 2})
    spaced = TEXT.replace(" ", "  \n ")
    assert client.post("/simplify", json={"text": spaced, "level": 2}).json()["cached"] is True
    assert client.post("/simplify", json={"text": TEXT, "level": 3}).json()["cached"] is False
    assert len(provider.calls) == 2


def test_level_is_in_the_system_prompt(make_client: MakeClient) -> None:
    client, provider = make_client()
    client.post("/simplify", json={"text": TEXT, "level": 3})
    system, user = provider.calls[0]
    assert "Level 3:" in system
    assert user.splitlines()[0] == "[1] The committee postponed the vote until March 2025."


def test_invalid_llm_output_is_retried_once(make_client: MakeClient) -> None:
    client, provider = make_client(["not json at all", GOOD])
    response = client.post("/simplify", json={"text": TEXT})
    assert response.status_code == 200
    assert len(provider.calls) == 2


def test_two_invalid_llm_outputs_give_502(make_client: MakeClient) -> None:
    client, provider = make_client(["{oops", {"simplified": "wrong type"}])
    response = client.post("/simplify", json={"text": TEXT})
    assert response.status_code == 502
    assert "invalid response" in response.json()["detail"]
    assert len(provider.calls) == 2


def test_provider_error_gives_502_without_retry(make_client: MakeClient) -> None:
    client, provider = make_client([LLMProviderError("Gemini API error (status 503)")])
    response = client.post("/simplify", json={"text": TEXT})
    assert response.status_code == 502
    assert len(provider.calls) == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "too short", "level": 2},
        {"text": "x" * 3001, "level": 2},
        {"text": "   " + "a" * 10 + "   " * 20, "level": 2},  # short once whitespace is normalised
        {"text": TEXT, "level": 4},
        {"text": TEXT, "level": "two"},
        {"level": 2},
        {"text": 123, "level": 2},
    ],
)
def test_bad_input_gives_400(make_client: MakeClient, payload: dict[str, object]) -> None:
    client, provider = make_client()
    response = client.post("/simplify", json=payload)
    assert response.status_code == 400
    assert "input" not in str(response.json())  # user text isn't echoed back
    assert provider.calls == []


def test_non_json_body_gives_400(make_client: MakeClient) -> None:
    client, _ = make_client()
    response = client.post(
        "/simplify", content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400


def test_rate_limit_is_30_per_minute(make_client: MakeClient) -> None:
    client, _ = make_client(limiter=RateLimiter(limit=30, window_s=60))
    codes = [client.post("/simplify", json={"text": TEXT}).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30
    assert codes[30] == 429


def test_cors_preflight_for_extension(make_client: MakeClient) -> None:
    client, _ = make_client()
    origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    response = client.options(
        "/simplify",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_logs_never_contain_user_text(
    make_client: MakeClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    client, _ = make_client(["{oops", GOOD])
    client.post("/simplify", json={"text": TEXT, "level": 2})  # retry path
    client.post("/simplify", json={"text": TEXT, "level": 2})  # cache hit
    client.post("/simplify", json={"text": "Short secret text."})  # 400

    bad_client, _ = make_client(["{oops", "{oops"])
    bad_client.post("/simplify", json={"text": TEXT, "level": 1})  # 502

    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "sha=" in logged and "len=" in logged
    fragments = ["committee", "postponed", "Turnout", "Officials", "secret", "moved the vote"]
    for fragment in fragments:
        assert fragment not in logged, fragment
