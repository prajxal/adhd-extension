import threading
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    """In-memory sliding-window limit per client key (IP)."""

    def __init__(
        self,
        limit: int = 30,
        window_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def allow(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            self._calls += 1
            if self._calls % 1000 == 0:
                self._prune(now)
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def _prune(self, now: float) -> None:
        """Forgets clients with no hits inside the window, so memory doesn't grow forever."""
        stale = [k for k, hits in self._hits.items() if not hits or now - hits[-1] >= self.window_s]
        for key in stale:
            del self._hits[key]

    @property
    def tracked(self) -> int:
        return len(self._hits)
