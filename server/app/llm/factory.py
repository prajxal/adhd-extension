from app.budget import BudgetedProvider, DailyBudget
from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.fake import FakeProvider
from app.llm.fallback import FallbackProvider
from app.llm.gemini import GeminiProvider


class ProviderConfigError(Exception):
    pass


def make_provider(settings: Settings, budget: DailyBudget | None = None) -> LLMProvider:
    """`budget` caps AI calls per day; every model attempt in the chain counts."""
    name = settings.llm_provider.strip().lower()
    if name == "fake":
        return BudgetedProvider(FakeProvider(), budget) if budget else FakeProvider()
    if name == "gemini":
        if not settings.gemini_api_key or not settings.llm_model:
            raise ProviderConfigError("Set GEMINI_API_KEY and LLM_MODEL in server/.env")
        chain: list[tuple[str, LLMProvider]] = []
        for model in settings.model_chain:
            provider: LLMProvider = GeminiProvider(
                settings.gemini_api_key, model, settings.llm_timeout_s
            )
            chain.append((model, BudgetedProvider(provider, budget) if budget else provider))
        return FallbackProvider(chain)
    raise ProviderConfigError(f"Unknown LLM_PROVIDER {settings.llm_provider!r}")
