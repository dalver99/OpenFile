"""Delivery and solve-state persistence.

``puzzle_progress`` holds one row per (user, puzzle) and is channel-agnostic:
Telegram writes it today, a future web UI reads/writes the same rows. Puzzles
belong to a user via ``puzzles.source_player_id`` (a public.users id), which is
the same id ``telegram_users.user_id`` points at.
"""

from __future__ import annotations

from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row


def list_active_telegram_users(conn: Connection) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, user_id, telegram_id, telegram_username, daily_quota
            FROM telegram_users
            WHERE is_active = TRUE
            ORDER BY id ASC
            """
        )
        return [dict(r) for r in cur.fetchall()]


def get_telegram_user(conn: Connection, telegram_id: int) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, user_id, telegram_id, telegram_username, is_active, daily_quota
            FROM telegram_users
            WHERE telegram_id = %s AND is_active = TRUE
            """,
            (telegram_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def count_sent_on_date(conn: Connection, user_id: int, date_iso: str, tz_name: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM puzzle_progress
            WHERE user_id = %s
              AND channel = 'telegram'
              AND (sent_at AT TIME ZONE %s)::date = %s::date
            """,
            (user_id, tz_name, date_iso),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def _pick_undelivered_sql(with_phase: bool, limit: bool) -> str:
    phase_clause = "AND p.phase = %s" if with_phase else ""
    limit_clause = "LIMIT %s" if limit else "LIMIT 1"
    return f"""
        SELECT p.*
        FROM puzzles p
        LEFT JOIN puzzle_progress pp
          ON pp.puzzle_id = p.id AND pp.user_id = %s
        WHERE p.source_player_id = %s
          {phase_clause}
          AND pp.id IS NULL
        ORDER BY COALESCE(p.quality_score, 0) DESC, random()
        {limit_clause}
    """


def pick_undelivered_puzzle(
    conn: Connection, user_id: int, phase: str | None = None
) -> dict[str, Any] | None:
    params: list[Any] = [user_id, user_id]
    if phase:
        params.append(phase)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_pick_undelivered_sql(phase is not None, limit=False), tuple(params))
        row = cur.fetchone()
        return dict(row) if row else None


def pick_undelivered_puzzles(
    conn: Connection, user_id: int, limit_n: int, phase: str | None = None
) -> list[dict[str, Any]]:
    params: list[Any] = [user_id, user_id]
    if phase:
        params.append(phase)
    params.append(limit_n)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_pick_undelivered_sql(phase is not None, limit=True), tuple(params))
        return [dict(r) for r in cur.fetchall()]


def record_sent(
    conn: Connection,
    *,
    puzzle_id: int,
    user_id: int,
    channel: str = "telegram",
    telegram_message_id: int | None = None,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO puzzle_progress (puzzle_id, user_id, status, attempts, channel, telegram_message_id)
            VALUES (%s, %s, 'sent', 0, %s, %s)
            ON CONFLICT (puzzle_id, user_id) DO UPDATE SET
                channel = EXCLUDED.channel,
                telegram_message_id = EXCLUDED.telegram_message_id
            RETURNING id
            """,
            (puzzle_id, user_id, channel, telegram_message_id),
        )
        return int(cur.fetchone()[0])


def get_latest_pending(conn: Connection, user_id: int) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
                pp.id AS progress_id,
                pp.attempts,
                pp.status,
                p.id AS puzzle_id,
                p.fen_before,
                p.solution_uci,
                p.solution_san,
                p.phase,
                p.tag,
                p.cp_loss
            FROM puzzle_progress pp
            JOIN puzzles p ON p.id = pp.puzzle_id
            WHERE pp.user_id = %s AND pp.status = 'sent'
            ORDER BY pp.sent_at DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def mark_solved(conn: Connection, progress_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE puzzle_progress
            SET status = 'solved', attempts = attempts + 1,
                solved_at = now(), last_attempt_at = now()
            WHERE id = %s
            """,
            (progress_id,),
        )


def increment_attempt(conn: Connection, progress_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE puzzle_progress
            SET attempts = attempts + 1, last_attempt_at = now()
            WHERE id = %s
            RETURNING attempts
            """,
            (progress_id,),
        )
        return int(cur.fetchone()[0])


def mark_revealed(conn: Connection, progress_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE puzzle_progress
            SET status = 'revealed', last_attempt_at = now()
            WHERE id = %s
            """,
            (progress_id,),
        )
