from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.cache import ResponseCache
from app.llm.fake import FakeProvider
from app.main import create_app
from app.meaning.check import CheckService, MeaningCheckMode
from app.pipeline import SimplifyService
from app.ratelimit import RateLimiter

TEXT = (
    "The committee postponed the vote until March 2025. "
    "Turnout fell by 12.5% compared with the previous year. "
    "Officials did not explain the reason for the delay."
)

GOOD: dict[str, Any] = {
    "simplified": [
        {"text": "The group moved the vote to March 2025.", "sourceIds": [1]},
        {"text": "12.5% fewer people voted than the year before.", "sourceIds": [2]},
        {"text": "Officials did not say why.", "sourceIds": [3]},
    ],
    "tldr": "The vote was moved to March 2025.",
    "glossary": [{"term": "postponed", "definition": "moved to a later time"}],
}

MakeClient = Callable[..., tuple[TestClient, FakeProvider]]


@pytest.fixture
def make_client(tmp_path: Path) -> MakeClient:
    def _make(
        responses: list[Any] | None = None,
        limiter: RateLimiter | None = None,
        mode: MeaningCheckMode = "llm",
        repair: bool = True,
    ) -> tuple[TestClient, FakeProvider]:
        provider = FakeProvider(responses if responses is not None else [GOOD])
        path = str(tmp_path / "cache.sqlite3")
        service = SimplifyService(provider, ResponseCache(path), model="fake-model")
        checker = CheckService(
            service, provider, ResponseCache(path, table="check_cache"), mode, repair=repair
        )
        app = create_app(service=service, limiter=limiter, check_service=checker)
        return TestClient(app), provider

    return _make


def with_(**changes: Any) -> dict[str, Any]:
    """A copy of GOOD with some top-level fields replaced."""
    return {**GOOD, **changes}
