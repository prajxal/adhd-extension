import re
import sqlite3
from contextlib import closing
from datetime import UTC, datetime


class ResponseCache:
    """SQLite cache of JSON responses. One short-lived connection per call (thread-safe)."""

    def __init__(self, path: str, table: str = "cache") -> None:
        if not re.fullmatch(r"[a-z_]+", table):
            raise ValueError(f"bad table name {table!r}")
        self._path = path
        self._table = table
        with closing(self._connect()) as conn, conn:
            conn.execute(
                f"CREATE TABLE IF NOT EXISTS {table} ("
                "key TEXT PRIMARY KEY, response_json TEXT, created_at TEXT)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=5)

    def get(self, key: str) -> str | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                f"SELECT response_json FROM {self._table} WHERE key = ?", (key,)
            ).fetchone()
        return None if row is None else str(row[0])

    def put(self, key: str, response_json: str) -> None:
        created_at = datetime.now(UTC).isoformat(timespec="seconds")
        with closing(self._connect()) as conn, conn:
            conn.execute(
                f"INSERT OR REPLACE INTO {self._table} (key, response_json, created_at) "
                "VALUES (?, ?, ?)",
                (key, response_json, created_at),
            )
