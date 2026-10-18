from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    llm_provider: str = "gemini"
    llm_model: str = ""
    # Comma-separated, tried in order when the main model is unavailable.
    llm_fallback_models: str = ""
    llm_timeout_s: float = 30.0
    gemini_api_key: str = ""
    cache_path: str = "cache.sqlite3"
    # Phase 2 meaning check: LLM judge + rules, rules only, or turned off.
    meaning_check: Literal["llm", "rules", "off"] = "llm"
    # Phase 3 auto-repair of `problem` sentences (only when meaning_check is "llm").
    meaning_repair: Literal["on", "off"] = "on"

    # Phase 4: production hardening. Unset limits take the defaults for APP_ENV.
    app_env: Literal["development", "production"] = "development"
    allowed_extension_ids: str = ""  # comma-separated Chrome extension IDs (production CORS)
    rate_limit_per_minute: int | None = None
    rate_limit_per_day: int | None = None
    daily_ai_call_limit: int | None = None
    cache_ttl_hours: float = 24.0
    privacy_contact: str = ""

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def extension_ids(self) -> list[str]:
        return [i.strip() for i in self.allowed_extension_ids.split(",") if i.strip()]

    @property
    def per_minute(self) -> int:
        return self.rate_limit_per_minute or (20 if self.is_production else 30)

    @property
    def per_day(self) -> int | None:
        return self.rate_limit_per_day or (200 if self.is_production else None)

    @property
    def ai_calls_per_day(self) -> int | None:
        return self.daily_ai_call_limit or (500 if self.is_production else None)

    @property
    def model_chain(self) -> list[str]:
        """Main model first, then fallbacks; blanks and duplicates removed."""
        names = [self.llm_model, *self.llm_fallback_models.split(",")]
        return list(dict.fromkeys(n.strip() for n in names if n.strip()))


@lru_cache
def get_settings() -> Settings:
    return Settings()
