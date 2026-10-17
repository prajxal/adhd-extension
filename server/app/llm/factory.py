from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.fake import FakeProvider
from app.llm.fallback import FallbackProvider
from app.llm.gemini import GeminiProvider


class ProviderConfigError(Exception):
    pass


def make_provider(settings: Settings) -> LLMProvider:
    name = settings.llm_provider.strip().lower()
    if name == "fake":
        return FakeProvider()
    if name == "gemini":
        if not settings.gemini_api_key or not settings.llm_model:
            raise ProviderConfigError("Set GEMINI_API_KEY and LLM_MODEL in server/.env")
        chain: list[tuple[str, LLMProvider]] = [
            (model, GeminiProvider(settings.gemini_api_key, model, settings.llm_timeout_s))
            for model in settings.model_chain
        ]
        return FallbackProvider(chain)
    raise ProviderConfigError(f"Unknown LLM_PROVIDER {settings.llm_provider!r}")
