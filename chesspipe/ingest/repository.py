from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
import json
from typing import Any, TypedDict

from chesspipe.storage import Connection

from chesspipe.ingest.chesscom import LOSS_RESULTS, ChessComClient, ChessComGame


def get_target_player(conn: Connection, target_user_id: int) -> dict[str, Any] | None:
    """Return {id, username} for the target user, or None if not linkable."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT user_id AS id, LOWER(chessdotcom_id) AS username
            FROM users
            WHERE user_id = ?
              AND deleted = FALSE
              AND chessdotcom_id IS NOT NULL
              AND chessdotcom_id <> ''
            """,
            (target_user_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


class SyncSummary(TypedDict):
    fetched: int
    upserted: int
    added: int
    existing: int
    player_game_ids: list[int]


def existing_game_urls(conn: Connection, player_id: int, urls: list[str]) -> set[str]:
    if not urls:
        return set()
    placeholders = ", ".join("?" for _ in urls)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT g.chesscom_url
            FROM chesscom_games g
            JOIN player_games pg ON pg.game_id = g.id
            WHERE pg.player_id = ? AND g.chesscom_url IN ({placeholders})
            """,
            (player_id, *urls),
        )
        return {str(row[0]) for row in cur.fetchall()}


def sync_recent_games(
    conn: Connection,
    client: ChessComClient,
    player_id: int,
    username: str,
    *,
    archive_months: int,
    max_sync_games: int,
    refresh_existing: bool,
    log: Callable[[str], None],
    progress: Callable[[str, dict[str, int]], None] | None = None,
    record_new_game: Callable[[int, str | None], None] | None = None,
) -> SyncSummary:
    """Fetch recent games and normally write only previously unseen URLs."""
    games = client.recent_games(username, archive_months, progress=progress)
    if max_sync_games > 0:
        games = games[:max_sync_games]
    fetched = len(games)
    known_urls = existing_game_urls(conn, player_id, [game.url for game in games])
    new_games = [game for game in games if game.url not in known_urls]
    pending = games if refresh_existing else new_games
    added = len(new_games)
    existing = fetched - added
    if progress:
        progress(
            "comparing",
            {"checked": fetched, "added": added, "existing_count": existing},
        )
    total = len(pending)
    player_game_ids: list[int] = []
    for i, game in enumerate(pending):
        player_game_id = upsert_game_and_player(conn, player_id, username, game)
        if game.url not in known_urls:
            player_game_ids.append(player_game_id)
            if record_new_game:
                record_new_game(player_game_id, game.time_class)
        if progress:
            progress(
                "saving",
                {
                    "checked": fetched,
                    "added": added,
                    "existing_count": existing,
                    "processed": i + 1,
                },
            )
        if total and (i + 1) % 25 == 0:
            log(f"Chess.com sync player_id={player_id}: imported {i + 1}/{total} new games")
    log(
        f"Chess.com sync player_id={player_id}: checked {fetched} recent games, "
        f"imported {total}"
    )
    return {
        "fetched": fetched,
        "upserted": total,
        "added": added,
        "existing": existing,
        "player_game_ids": player_game_ids,
    }


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
        datetime.fromtimestamp(game.end_time, tz=timezone.utc).isoformat()
        if game.end_time else None
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO chesscom_games (
                chesscom_url, white_username, black_username,
                white_rating, black_rating, white_result, black_result,
                end_time, time_class, time_control, rules, rated, eco_url, pgn, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                json.dumps(game.raw),
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
            VALUES (?, ?, ?, ?, ?, ?, 'ingested')
            ON CONFLICT (player_id, game_id) DO UPDATE SET
                side = EXCLUDED.side,
                result = EXCLUDED.result,
                is_loss = EXCLUDED.is_loss,
                rating_after = EXCLUDED.rating_after
            RETURNING id
            """,
            (tracked_player_id, game_id, side, result, is_loss, rating_after),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("upsert player_games failed")
        player_game_id = int(row[0])

    if eco_url_clean:
        link_game_opening(conn, game_id, eco_url_clean)

    return player_game_id


def link_game_opening(conn: Connection, game_id: int, eco_url: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO openings (eco_url) VALUES (?)
            ON CONFLICT (eco_url) DO UPDATE SET eco_url = EXCLUDED.eco_url
            RETURNING id
            """,
            (eco_url,),
        )
        opening_id = int(cur.fetchone()[0])
        cur.execute(
            """
            INSERT INTO game_openings (game_id, opening_id, source)
            VALUES (?, ?, 'chesscom_eco')
            ON CONFLICT (game_id, opening_id, source) DO NOTHING
            """,
            (game_id, opening_id),
        )
