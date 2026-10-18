"""
A server-wide cap on AI calls per UTC day, so a public endpoint can't run up the
Gemini bill (or burn the free quota) without limit. Every call to a provider counts:
fallbacks, retries, the meaning-check judge and repairs.
"""

import threading
from collections.abc import Callable
from datetime import UTC, date, datetime

from app.llm.base import DailyLimitError, LLMProvider, T
from app.logging_utils import logger


def _utc_today() -> date:
    return datetime.now(UTC).date()


class DailyBudget:
    def __init__(self, limit: int, today: Callable[[], date] = _utc_today) -> None:
        self.limit = limit
        self._today = today
        self._day = today()
        self._used = 0
        self._lock = threading.Lock()
        self._warned = False

    @property
    def used(self) -> int:
        return self._used

    def try_spend(self) -> bool:
        with self._lock:
            day = self._today()
            if day != self._day:
                self._day, self._used, self._warned = day, 0, False
            if self._used >= self.limit:
                if not self._warned:
                    logger.warning("daily AI call limit reached limit=%d", self.limit)
                    self._warned = True
                return False
            self._used += 1
            return True


class BudgetedProvider:
    """Wraps one provider; refuses with DailyLimitError once the day's budget is spent."""

    def __init__(self, inner: LLMProvider, budget: DailyBudget) -> None:
        self._inner = inner
        self._budget = budget

    def generate_json(self, system: str, user: str, schema: type[T]) -> T:
        if not self._budget.try_spend():
            raise DailyLimitError("Daily AI call limit reached")
        return self._inner.generate_json(system, user, schema)
