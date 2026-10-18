import threading
import time
from collections.abc import Callable

from app.llm.base import DailyLimitError, LLMProvider, LLMProviderError, T
from app.logging_utils import logger

COOLDOWN_S = 60.0


class FallbackProvider:
    """
    Tries models in order. If one fails with a provider error (unavailable, timeout),
    the next is tried, and the failed one is skipped for COOLDOWN_S so later requests
    don't each wait for it to time out. Bad JSON is not a provider error: it goes back
    to the pipeline, which retries once.
    """

    def __init__(
        self,
        providers: list[tuple[str, LLMProvider]],
        cooldown_s: float = COOLDOWN_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not providers:
            raise ValueError("FallbackProvider needs at least one provider")
        self._providers = providers
        self._cooldown_s = cooldown_s
        self._clock = clock
        self._failed_at: dict[str, float] = {}
        self._lock = threading.Lock()

    def _order(self) -> list[tuple[str, LLMProvider]]:
        now = self._clock()
        with self._lock:
            ready = [
                p
                for p in self._providers
                if now - self._failed_at.get(p[0], -1e18) >= self._cooldown_s
            ]
        # If every model is cooling down, try them all anyway rather than fail outright.
        return ready or self._providers

    def generate_json(self, system: str, user: str, schema: type[T]) -> T:
        last_error: LLMProviderError | None = None
        for name, provider in self._order():
            try:
                result = provider.generate_json(system, user, schema)
            except DailyLimitError:
                raise  # the whole server is out of budget: other models won't help
            except LLMProviderError as exc:
                logger.warning("model %s failed (%s); trying next", name, exc)
                with self._lock:
                    self._failed_at[name] = self._clock()
                last_error = exc
                continue
            with self._lock:
                self._failed_at.pop(name, None)
            logger.info("model %s answered", name)
            return result
        assert last_error is not None
        raise LLMProviderError(f"All models failed; last: {last_error}") from None
