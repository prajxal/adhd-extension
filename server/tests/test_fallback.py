import pytest

from app.config import Settings
from app.llm.base import LLMProviderError
from app.llm.factory import ProviderConfigError, make_provider
from app.llm.fake import FakeProvider
from app.llm.fallback import FallbackProvider
from app.schemas import LLMOutput
from tests.conftest import GOOD

DOWN = LLMProviderError("Gemini API error (status 503)")


def chain(*providers: FakeProvider, now: list[float]) -> FallbackProvider:
    named = [(f"m{i}", p) for i, p in enumerate(providers)]
    return FallbackProvider(named, cooldown_s=60, clock=lambda: now[0])


def test_uses_primary_when_it_works() -> None:
    primary, backup = FakeProvider([GOOD]), FakeProvider([GOOD])
    chain(primary, backup, now=[0.0]).generate_json("s", "u", LLMOutput)
    assert len(primary.calls) == 1
    assert backup.calls == []


def test_falls_back_on_provider_error() -> None:
    primary, backup = FakeProvider([DOWN]), FakeProvider([GOOD])
    out = chain(primary, backup, now=[0.0]).generate_json("s", "u", LLMOutput)
    assert out.tldr == GOOD["tldr"]
    assert len(primary.calls) == 1 and len(backup.calls) == 1


def test_failed_model_is_skipped_during_cooldown_then_retried() -> None:
    now = [0.0]
    primary, backup = FakeProvider([DOWN, GOOD]), FakeProvider([GOOD])
    provider = chain(primary, backup, now=now)
    provider.generate_json("s", "u", LLMOutput)  # primary fails, backup answers
    now[0] = 30.0
    provider.generate_json("s", "u", LLMOutput)  # primary still cooling down
    assert len(primary.calls) == 1 and len(backup.calls) == 2
    now[0] = 61.0
    provider.generate_json("s", "u", LLMOutput)  # primary back in rotation
    assert len(primary.calls) == 2 and len(backup.calls) == 2


def test_all_models_failing_raises_provider_error() -> None:
    provider = chain(FakeProvider([DOWN]), FakeProvider([DOWN]), now=[0.0])
    with pytest.raises(LLMProviderError, match="All models failed"):
        provider.generate_json("s", "u", LLMOutput)


def test_all_cooling_down_still_tries_them() -> None:
    now = [0.0]
    primary, backup = FakeProvider([DOWN, GOOD]), FakeProvider([DOWN])
    provider = chain(primary, backup, now=now)
    with pytest.raises(LLMProviderError):
        provider.generate_json("s", "u", LLMOutput)
    now[0] = 5.0
    assert provider.generate_json("s", "u", LLMOutput).tldr == GOOD["tldr"]


def test_bad_json_is_not_a_fallback_reason() -> None:
    primary, backup = FakeProvider(["{oops"]), FakeProvider([GOOD])
    with pytest.raises(ValueError):  # pydantic ValidationError is a ValueError
        chain(primary, backup, now=[0.0]).generate_json("s", "u", LLMOutput)
    assert backup.calls == []


def test_factory_builds_chain_from_settings() -> None:
    settings = Settings(
        llm_provider="gemini",
        llm_model="model-a",
        llm_fallback_models=" model-b, model-a ,,model-c ",
        gemini_api_key="test-key",
    )
    assert settings.model_chain == ["model-a", "model-b", "model-c"]
    assert isinstance(make_provider(settings), FallbackProvider)


def test_factory_requires_model_and_key() -> None:
    with pytest.raises(ProviderConfigError):
        make_provider(Settings(llm_provider="gemini", llm_model="", gemini_api_key="k"))
