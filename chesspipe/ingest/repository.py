from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from chesspipe.ingest.chesscom import LOSS_RESULTS, ChessComClient, ChessComGame


def get_target_player(conn: Connection, target_user_id: int) -> dict[str, Any] | None:
    """Return {id, username} for the target user, or None if not linkable."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT user_id AS id, LOWER(chessdotcom_id) AS username
            FROM public.users
            WHERE user_id = %s
              AND deleted = FALSE
              AND chessdotcom_id IS NOT NULL
              AND chessdotcom_id <> ''
            """,
            (target_user_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def newest_stored_game_end(conn: Connection, player_id: int) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(g.end_time)
            FROM player_games pg
            JOIN chesscom_games g ON g.id = pg.game_id
            WHERE pg.player_id = %s AND g.end_time IS NOT NULL
            """,
            (player_id,),
        )
        row = cur.fetchone()
    if row is None or row[0] is None:
        return None
    end = row[0]
    if isinstance(end, datetime) and end.tzinfo is None:
        return end.replace(tzinfo=timezone.utc)
    return end


def sync_recent_games(
    conn: Connection,
    client: ChessComClient,
    player_id: int,
    username: str,
    *,
    archive_months: int,
    max_sync_games: int,
    skip_fetch_if_fresh_within_days: int,
    log: Callable[[str], None],
) -> int:
    """Upsert recent Chess.com games. Skips the HTTP fetch when local data is fresh."""
    if skip_fetch_if_fresh_within_days > 0:
        threshold = datetime.now(timezone.utc) - timedelta(days=skip_fetch_if_fresh_within_days)
        newest = newest_stored_game_end(conn, player_id)
        if newest is not None and newest >= threshold:
            log(
                f"skip Chess.com sync player_id={player_id}: newest stored game ended "
                f"{newest.isoformat()} (within last {skip_fetch_if_fresh_within_days} days)"
            )
            return 0

    games = client.recent_games(username, archive_months)
    if max_sync_games > 0:
        games = games[:max_sync_games]
    total = len(games)
    for i, game in enumerate(games):
        upsert_game_and_player(conn, player_id, username, game)
        if total and (i + 1) % 25 == 0:
            log(f"Chess.com sync player_id={player_id}: upserted {i + 1}/{total} games")
    log(f"Chess.com sync player_id={player_id}: upserted {total} games")
    return total


def upsert_game_and_player(
    conn: Connection,
    tracked_player_id: int,
    tracked_username: str,
    game: ChessComGame,
) -> int:
    white_u = str(game.white.get("username", "")).strip()
    black_u = str(game.black.get("username", "")).strip()

    eco_raw = game.raw.get("eco")
    eco_url_clean = eco_raw.strip() if isinstance(eco_raw, str) and eco_raw.strip() else None

    end_dt = (
        datetime.fromtimestamp(game.end_time, tz=timezone.utc) if game.end_time else None
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO chesscom_games (
                chesscom_url, white_username, black_username,
                white_rating, black_rating, white_result, black_result,
                end_time, time_class, time_control, rules, rated, eco_url, pgn, raw_json
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (chesscom_url) DO UPDATE SET
                white_rating = EXCLUDED.white_rating,
                black_rating = EXCLUDED.black_rating,
                white_result = EXCLUDED.white_result,
                black_result = EXCLUDED.black_result,
                end_time = EXCLUDED.end_time,
                time_class = EXCLUDED.time_class,
                time_control = EXCLUDED.time_control,
                rules = EXCLUDED.rules,
                rated = EXCLUDED.rated,
                eco_url = COALESCE(EXCLUDED.eco_url, chesscom_games.eco_url),
                pgn = EXCLUDED.pgn,
                raw_json = EXCLUDED.raw_json
            RETURNING id
            """,
            (
                game.url,
                white_u.lower(),
                black_u.lower(),
                game.white.get("rating"),
                game.black.get("rating"),
                game.white.get("result"),
                game.black.get("result"),
                end_dt,
                game.time_class,
                game.time_control,
                game.rules,
                game.raw.get("rated"),
                eco_url_clean,
                game.pgn,
                Json(game.raw),
            ),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("upsert chesscom_games failed")
        game_id = int(row[0])

    tracked_lower = tracked_username.lower()
    if white_u.lower() == tracked_lower:
        side, result, rating_after = "white", str(game.white.get("result", "")), game.white.get("rating")
    elif black_u.lower() == tracked_lower:
        side, result, rating_after = "black", str(game.black.get("result", "")), game.black.get("rating")
    else:
        return game_id

    is_loss = result in LOSS_RESULTS

    # Insert as 'ingested'; on re-sync, refresh facts but never reset pipeline status.
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO player_games (player_id, game_id, side, result, is_loss, rating_after, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'ingested')
            ON CONFLICT (player_id, game_id) DO UPDATE SET
                side = EXCLUDED.side,
                result = EXCLUDED.result,
                is_loss = EXCLUDED.is_loss,
                rating_after = EXCLUDED.rating_after
            """,
            (tracked_player_id, game_id, side, result, is_loss, rating_after),
        )

    if eco_url_clean:
        link_game_opening(conn, game_id, eco_url_clean)

    return game_id


def link_game_opening(conn: Connection, game_id: int, eco_url: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO openings (eco_url) VALUES (%s)
            ON CONFLICT (eco_url) DO UPDATE SET eco_url = EXCLUDED.eco_url
            RETURNING id
            """,
            (eco_url,),
        )
        opening_id = int(cur.fetchone()[0])
        cur.execute(
            """
            INSERT INTO game_openings (game_id, opening_id, source)
            VALUES (%s, %s, 'chesscom_eco')
            ON CONFLICT (game_id, opening_id, source) DO NOTHING
            """,
            (game_id, opening_id),
        )
