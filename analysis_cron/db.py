from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import Connection


@contextmanager
def get_connection(database_url: str, db_schema: str) -> Iterator[Connection]:
    conn = psycopg.connect(database_url, autocommit=False)
    try:
        with conn.cursor() as cur:
            # Keep table SQL unqualified and route through configured schema.
            cur.execute("SELECT set_config('search_path', %s, false)", (f"{db_schema},public",))
        yield conn
    finally:
        conn.close()
