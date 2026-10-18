"""Phase 4 production hardening: CORS, docs, body size, limits, AI budget, cache expiry, privacy."""

import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.budget import BudgetedProvider, DailyBudget
from app.cache import ResponseCache
from app.config import Settings
from app.llm.base import DailyLimitError, LLMProviderError
from app.llm.fake import FakeProvider
from app.llm.fallback import FallbackProvider
from app.main import DAILY_LIMIT_MESSAGE, create_app
from app.meaning.check import CheckService
from app.pipeline import SimplifyService
from app.ratelimit import RateLimiter
from app.schemas import LLMOutput
from tests.conftest import GOOD, TEXT

OTHER_TEXT = "A completely different passage that also needs simplifying for the reader."


def production(**overrides: Any) -> Settings:
    base: dict[str, Any] = {"app_env": "production", "allowed_extension_ids": "abcdefgh,ijklmnop"}
    return Settings(**{**base, **overrides})


def client_for(
    tmp_path: Path, settings: Settings, provider: Any = None, **kwargs: Any
) -> TestClient:
    provider = provider or FakeProvider([GOOD])
    path = str(tmp_path / "c.sqlite3")
    service = SimplifyService(provider, ResponseCache(path), model="fake-model")
    checker = CheckService(service, provider, ResponseCache(path, table="check_cache"), "llm")
    return TestClient(
        create_app(service=service, check_service=checker, settings=settings, **kwargs)
    )


# ---------------------------------------------------------------- settings defaults


def test_production_defaults_are_stricter() -> None:
    prod, dev = production(), Settings(app_env="development")
    assert (prod.per_minute, prod.per_day, prod.ai_calls_per_day) == (20, 200, 500)
    assert (dev.per_minute, dev.per_day, dev.ai_calls_per_day) == (30, None, None)
    assert production(rate_limit_per_day=50).per_day == 50
    assert production(allowed_extension_ids=" a , ,b ").extension_ids == ["a", "b"]


# ---------------------------------------------------------------- CORS and docs


def test_production_cors_allows_only_configured_extensions(tmp_path: Path) -> None:
    client = client_for(tmp_path, production())
    allowed = client.get("/health", headers={"Origin": "chrome-extension://abcdefgh"})
    assert allowed.headers["access-control-allow-origin"] == "chrome-extension://abcdefgh"
    other = client.get("/health", headers={"Origin": "chrome-extension://someoneelse"})
    assert "access-control-allow-origin" not in other.headers
    web = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in web.headers


def test_production_without_extension_ids_allows_no_origin_and_warns(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    client = client_for(tmp_path, production(allowed_extension_ids=""))
    response = client.get("/health", headers={"Origin": "chrome-extension://abcdefgh"})
    assert "access-control-allow-origin" not in response.headers
    assert "ALLOWED_EXTENSION_IDS is empty" in caplog.text


def test_development_allows_any_extension(tmp_path: Path) -> None:
    client = client_for(tmp_path, Settings(app_env="development"))
    response = client.get("/health", headers={"Origin": "chrome-extension://anything"})
    assert response.headers["access-control-allow-origin"] == "chrome-extension://anything"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_docs_are_off_in_production_only(tmp_path: Path, path: str) -> None:
    assert client_for(tmp_path, production()).get(path).status_code == 404
    assert client_for(tmp_path, Settings(app_env="development")).get(path).status_code == 200


# ---------------------------------------------------------------- body size


def test_oversized_body_is_rejected_with_413(tmp_path: Path) -> None:
    client = client_for(tmp_path, production())
    response = client.post(
        "/simplify",
        content=b'{"text": "' + b"a" * 70_000 + b'"}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_oversized_chunked_body_without_length_is_rejected(tmp_path: Path) -> None:
    client = client_for(tmp_path, production())

    def chunks() -> Any:
        yield b'{"text": "'
        for _ in range(20):
            yield b"a" * 4096
        yield b'"}'

    response = client.post(
        "/simplify", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_normal_body_still_works(tmp_path: Path) -> None:
    assert (
        client_for(tmp_path, production()).post("/simplify", json={"text": TEXT}).status_code == 200
    )


# ---------------------------------------------------------------- per-IP limits


def test_per_minute_limit(tmp_path: Path) -> None:
    client = client_for(tmp_path, production(), limiter=RateLimiter(limit=2, window_s=60))
    codes = [client.post("/simplify", json={"text": TEXT}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_per_day_limit_counts_cached_requests_too(tmp_path: Path) -> None:
    client = client_for(tmp_path, production(), day_limiter=RateLimiter(limit=3, window_s=86_400))
    codes = [client.post("/simplify", json={"text": TEXT}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]  # 2nd and 3rd were cache hits
    last = client.post("/simplify", json={"text": TEXT})
    assert "today's limit" in last.json()["detail"]


def test_rate_limiter_forgets_idle_clients() -> None:
    now = [0.0]
    limiter = RateLimiter(limit=5, window_s=60, clock=lambda: now[0])
    for i in range(999):
        limiter.allow(f"ip-{i}")
    now[0] = 61.0
    limiter.allow("fresh")  # 1000th call triggers a prune
    assert limiter.tracked == 1


# ---------------------------------------------------------------- daily AI budget


def test_budget_resets_on_a_new_utc_day() -> None:
    day = [date(2026, 10, 18)]
    budget = DailyBudget(2, today=lambda: day[0])
    assert [budget.try_spend() for _ in range(3)] == [True, True, False]
    day[0] = date(2026, 10, 19)
    assert budget.try_spend() is True


def test_fallback_stops_at_the_daily_limit_instead_of_trying_other_models() -> None:
    budget = DailyBudget(0)
    first, second = FakeProvider([GOOD]), FakeProvider([GOOD])
    chain = FallbackProvider([("a", BudgetedProvider(first, budget)), ("b", second)])
    with pytest.raises(DailyLimitError):
        chain.generate_json("s", "u", LLMOutput)
    assert second.calls == []


def test_daily_limit_gives_503_for_new_text_but_cache_still_works(tmp_path: Path) -> None:
    budget = DailyBudget(1)  # exactly one AI call today
    provider = BudgetedProvider(FakeProvider([GOOD]), budget)
    client = client_for(tmp_path, production(), provider=provider)
    assert client.post("/simplify", json={"text": TEXT}).status_code == 200
    assert client.post("/simplify", json={"text": TEXT}).json()["cached"] is True
    over = client.post("/simplify", json={"text": OTHER_TEXT})
    assert over.status_code == 503
    assert over.json()["detail"] == DAILY_LIMIT_MESSAGE
    # The meaning check falls back to rules instead of failing.
    check = client.post("/check", json={"text": TEXT})
    assert check.status_code == 200
    assert check.json()["judge"] == "rules"


def test_factory_applies_the_budget_to_every_provider() -> None:
    from app.llm.factory import make_provider

    for settings in (
        Settings(llm_provider="fake"),
        Settings(llm_provider="gemini", llm_model="m", gemini_api_key="k"),
    ):
        provider = make_provider(settings, DailyBudget(0))
        with pytest.raises(DailyLimitError):
            provider.generate_json("s", "u", LLMOutput)


def test_daily_limit_error_is_a_provider_error() -> None:
    assert issubclass(DailyLimitError, LLMProviderError)


# ---------------------------------------------------------------- cache expiry


def test_cache_entries_expire_and_are_pruned(tmp_path: Path) -> None:
    now = [datetime(2026, 10, 18, 12, 0, tzinfo=UTC)]
    cache = ResponseCache(str(tmp_path / "c.sqlite3"), ttl_hours=24, now=lambda: now[0])
    cache.put("old", '{"v": 1}')
    now[0] += timedelta(hours=23)
    assert cache.get("old") == '{"v": 1}'
    now[0] += timedelta(hours=2)
    assert cache.get("old") is None  # expired: never served
    cache.put("new", '{"v": 2}')  # more than an hour since the last prune → prunes
    assert cache.prune() == 0  # "old" is already gone
    assert cache.get("new") == '{"v": 2}'


def test_cache_without_ttl_keeps_entries(tmp_path: Path) -> None:
    cache = ResponseCache(str(tmp_path / "c.sqlite3"))
    cache.put("k", "v")
    assert cache.get("k") == "v"
    assert cache.prune() == 0


# ---------------------------------------------------------------- privacy page


def test_privacy_page_covers_the_policy(tmp_path: Path) -> None:
    client = client_for(
        tmp_path, production(privacy_contact="readwell@example.com", cache_ttl_hours=24)
    )
    response = client.get("/privacy")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    page = response.text
    for phrase in [
        "Only when you click <strong>Simplify</strong>",
        "Gemini API terms",
        "for up to 24 hours",
        "never contain your text",
        "processed on your computer",
        "No accounts, no advertising, no analytics",
        'href="mailto:readwell@example.com"',
    ]:
        assert phrase in page, phrase


def test_privacy_contact_defaults_to_the_issue_tracker(tmp_path: Path) -> None:
    page = client_for(tmp_path, production()).get("/privacy").text
    assert "https://github.com/prajxal/adhd-extension/issues" in page


def test_privacy_contact_is_escaped(tmp_path: Path) -> None:
    page = (
        client_for(tmp_path, production(privacy_contact='"><script>x</script>'))
        .get("/privacy")
        .text
    )
    assert "<script>x</script>" not in page
