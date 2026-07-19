"""SQLite storage for the local-first OpenFile application."""

from __future__ import annotations

import sqlite3
from typing import Any
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

class Cursor:
    def __init__(self, cursor: sqlite3.Cursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> "Cursor":
        return self

    def __exit__(self, *_args: object) -> None:
        self._cursor.close()

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> "Cursor":
        self._cursor.execute(sql, params)
        return self

    def executemany(self, sql: str, params: list[tuple[Any, ...]]) -> "Cursor":
        self._cursor.executemany(sql, params)
        return self

    def fetchone(self) -> sqlite3.Row | None:
        return self._cursor.fetchone()

    def fetchall(self) -> list[sqlite3.Row]:
        return self._cursor.fetchall()


class Connection:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def cursor(self) -> Cursor:
        return Cursor(self._connection.cursor())

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Cursor:
        return self._connection.execute(sql, params)

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()


def path_from_url(database_url: str) -> Path:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise RuntimeError("OpenFile currently supports SQLite URLs (sqlite:///path/to/file.db).")
    raw = database_url[len(prefix):]
    return Path(raw).expanduser().resolve()


def initialize_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    conn = sqlite3.connect(path)
    try:
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


@contextmanager
def get_connection(database_url: str, _db_schema: str = "") -> Iterator[Connection]:
    path = path_from_url(database_url)
    initialize_database(path)
    raw = sqlite3.connect(path, timeout=30)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    raw.execute("PRAGMA journal_mode = WAL")
    raw.execute("PRAGMA busy_timeout = 30000")
    conn = Connection(raw)
    try:
        yield conn
    finally:
        raw.close()
