"""Persistence helpers for observable Chess.com synchronization jobs."""

from __future__ import annotations

from typing import Any

from chesspipe.storage import Connection

UPDATABLE_FIELDS = {
    "status",
    "phase",
    "archives_total",
    "archives_done",
    "checked",
    "added",
    "existing_count",
    "processed",
    "error",
    "finished_at",
}


def create_sync_run(
    conn: Connection,
    *,
    user_id: int,
    archive_months: int,
    max_games: int,
    refresh_existing: bool,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_runs (
                user_id, status, phase, archive_months, max_games,
                refresh_existing
            )
            VALUES (?, 'running', 'connecting', ?, ?, ?)
            RETURNING id
            """,
            (user_id, archive_months, max_games, refresh_existing),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError("Could not create sync run.")
    return int(row[0])


def update_sync_run(
    conn: Connection,
    sync_run_id: int,
    *,
    only_if_running: bool = True,
    **values: Any,
) -> None:
    fields = [(key, value) for key, value in values.items() if key in UPDATABLE_FIELDS]
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key, _value in fields)
    where = "id = ?" + (" AND status = 'running'" if only_if_running else "")
    params = [value for _key, value in fields] + [sync_run_id]
    with conn.cursor() as cur:
        cur.execute(f"UPDATE sync_runs SET {assignments} WHERE {where}", tuple(params))


def record_sync_game(
    conn: Connection,
    sync_run_id: int,
    player_game_id: int,
    time_class: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_run_games (sync_run_id, player_game_id, time_class)
            VALUES (?, ?, ?)
            ON CONFLICT(sync_run_id, player_game_id) DO NOTHING
            """,
            (sync_run_id, player_game_id, time_class),
        )
