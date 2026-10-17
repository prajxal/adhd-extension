import sqlite3
from contextlib import closing
from datetime import UTC, datetime


class ResponseCache:
    """SQLite cache of /simplify responses. One short-lived connection per call (thread-safe)."""

    def __init__(self, path: str) -> None:
        self._path = path
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS cache ("
                "key TEXT PRIMARY KEY, response_json TEXT, created_at TEXT)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=5)

    def get(self, key: str) -> str | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT response_json FROM cache WHERE key = ?", (key,)).fetchone()
        return None if row is None else str(row[0])

    def put(self, key: str, response_json: str) -> None:
        created_at = datetime.now(UTC).isoformat(timespec="seconds")
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT OR REPLACE INTO cache (key, response_json, created_at) VALUES (?, ?, ?)",
                (key, response_json, created_at),
            )
