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
            WHERE telegram_id = %s
              AND is_active = TRUE
            """,
            (telegram_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def count_deliveries_on_date(conn: Connection, telegram_user_id: int, kst_date_iso: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM puzzle_deliveries
            WHERE telegram_user_id = %s
              AND (sent_at AT TIME ZONE 'Asia/Seoul')::date = %s::date
            """,
            (telegram_user_id, kst_date_iso),
        )
        row = cur.fetchone()
        if row is None:
            return 0
        return int(row[0])


def pick_undelivered_puzzle(
    conn: Connection,
    app_user_id: int,
    telegram_user_id: int,
    phase: str | None = None,
) -> dict[str, Any] | None:
    params: list[Any] = [telegram_user_id, app_user_id]
    phase_sql = ""
    if phase:
        phase_sql = "AND p.phase = %s"
        params.append(phase)

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT p.*
            FROM puzzles p
            LEFT JOIN puzzle_deliveries d
              ON d.puzzle_id = p.id
             AND d.telegram_user_id = %s
            WHERE p.source_player_id = %s
              {phase_sql}
              AND d.id IS NULL
            ORDER BY random()
            LIMIT 1
            """,
            tuple(params),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def pick_undelivered_puzzles(
    conn: Connection,
    app_user_id: int,
    telegram_user_id: int,
    limit_n: int,
    phase: str | None = None,
) -> list[dict[str, Any]]:
    params: list[Any] = [telegram_user_id, app_user_id]
    phase_sql = ""
    if phase:
        phase_sql = "AND p.phase = %s"
        params.append(phase)
    params.append(limit_n)

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT p.*
            FROM puzzles p
            LEFT JOIN puzzle_deliveries d
              ON d.puzzle_id = p.id
             AND d.telegram_user_id = %s
            WHERE p.source_player_id = %s
              {phase_sql}
              AND d.id IS NULL
            ORDER BY random()
            LIMIT %s
            """,
            tuple(params),
        )
        return [dict(r) for r in cur.fetchall()]


def insert_delivery(
    conn: Connection,
    puzzle_id: int,
    telegram_user_id: int,
    chat_message_id: int | None,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO puzzle_deliveries (puzzle_id, telegram_user_id, status, attempts, chat_message_id)
            VALUES (%s, %s, 'sent', 0, %s)
            RETURNING id
            """,
            (puzzle_id, telegram_user_id, chat_message_id),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("insert puzzle delivery failed")
        return int(row[0])


def get_latest_pending_delivery(conn: Connection, telegram_user_id: int) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
                d.id AS delivery_id,
                d.attempts,
                d.status,
                p.id AS puzzle_id,
                p.fen_before,
                p.solution_uci,
                p.solution_san,
                p.phase,
                p.tag,
                p.cp_loss
            FROM puzzle_deliveries d
            JOIN puzzles p ON p.id = d.puzzle_id
            WHERE d.telegram_user_id = %s
              AND d.status = 'sent'
            ORDER BY d.sent_at DESC
            LIMIT 1
            """,
            (telegram_user_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def mark_delivery_solved(conn: Connection, delivery_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE puzzle_deliveries
            SET status = 'solved',
                attempts = attempts + 1,
                solved_at = now(),
                last_attempt_at = now()
            WHERE id = %s
            """,
            (delivery_id,),
        )


def increment_delivery_attempt(conn: Connection, delivery_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE puzzle_deliveries
            SET attempts = attempts + 1,
                last_attempt_at = now()
            WHERE id = %s
            RETURNING attempts
            """,
            (delivery_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("increment delivery attempt failed")
        return int(row[0])


def mark_delivery_revealed(conn: Connection, delivery_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE puzzle_deliveries
            SET status = 'revealed',
                last_attempt_at = now()
            WHERE id = %s
            """,
            (delivery_id,),
        )

