from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import Connection


@contextmanager
def get_connection(database_url: str, db_schema: str) -> Iterator[Connection]:
    """Open a psycopg connection with search_path routed to the app schema.

    Optional escape hatch for broken/split-horizon DNS: if DB_HOSTADDR is set,
    libpq connects to that IP while still using the URL host for TLS SNI and
    certificate checks. Leave unset for normal DNS resolution.
    """
    connect_kwargs: dict[str, str] = {}
    hostaddr = os.getenv("DB_HOSTADDR")
    if hostaddr:
        connect_kwargs["hostaddr"] = hostaddr

    conn = psycopg.connect(database_url, autocommit=False, **connect_kwargs)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('search_path', %s, false)", (f"{db_schema},public",))
        yield conn
    finally:
        conn.close()
