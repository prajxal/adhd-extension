from functools import lru_cache

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

    @property
    def model_chain(self) -> list[str]:
        """Main model first, then fallbacks; blanks and duplicates removed."""
        names = [self.llm_model, *self.llm_fallback_models.split(",")]
        return list(dict.fromkeys(n.strip() for n in names if n.strip()))


@lru_cache
def get_settings() -> Settings:
    return Settings()
