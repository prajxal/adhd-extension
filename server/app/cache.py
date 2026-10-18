import re
import sqlite3
from collections.abc import Callable
from contextlib import closing
from datetime import UTC, datetime, timedelta

PRUNE_EVERY = timedelta(hours=1)


class ResponseCache:
    """SQLite cache of JSON responses. One short-lived connection per call (thread-safe)."""

    def __init__(
        self,
        path: str,
        table: str = "cache",
        ttl_hours: float | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not re.fullmatch(r"[a-z_]+", table):
            raise ValueError(f"bad table name {table!r}")
        self._path = path
        self._table = table
        self._ttl = timedelta(hours=ttl_hours) if ttl_hours else None
        self._now = now
        self._last_prune: datetime | None = None
        with closing(self._connect()) as conn, conn:
            conn.execute(
                f"CREATE TABLE IF NOT EXISTS {table} ("
                "key TEXT PRIMARY KEY, response_json TEXT, created_at TEXT)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=5)

    def _cutoff(self) -> str | None:
        """Entries created before this (ISO-8601 UTC, sorts as text) have expired."""
        return (self._now() - self._ttl).isoformat(timespec="seconds") if self._ttl else None

    def get(self, key: str) -> str | None:
        cutoff = self._cutoff()
        with closing(self._connect()) as conn:
            row = conn.execute(
                f"SELECT response_json, created_at FROM {self._table} WHERE key = ?", (key,)
            ).fetchone()
        if row is None or (cutoff is not None and str(row[1]) < cutoff):
            return None
        return str(row[0])

    def prune(self) -> int:
        """Deletes expired entries. Returns how many were deleted."""
        cutoff = self._cutoff()
        if cutoff is None:
            return 0
        with closing(self._connect()) as conn, conn:
            deleted = conn.execute(
                f"DELETE FROM {self._table} WHERE created_at < ?", (cutoff,)
            ).rowcount
        self._last_prune = self._now()
        return int(deleted)

    def put(self, key: str, response_json: str) -> None:
        if self._ttl and (
            self._last_prune is None or self._now() - self._last_prune >= PRUNE_EVERY
        ):
            self.prune()
        created_at = self._now().isoformat(timespec="seconds")
        with closing(self._connect()) as conn, conn:
            conn.execute(
                f"INSERT OR REPLACE INTO {self._table} (key, response_json, created_at) "
                "VALUES (?, ?, ?)",
                (key, response_json, created_at),
            )
