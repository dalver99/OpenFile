from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from analysis_cron.chesscom import LOSS_RESULTS, ChessComClient, ChessComGame


def list_active_players(conn: Connection, target_user_id: int) -> list[dict[str, Any]]:
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
        return list(cur.fetchall())


def acquire_daily_run(
    conn: Connection,
    run_date: date,
    player_id: int,
    stale_minutes: int = 60,
) -> str:
    """
    Claim a run row for (run_date, player_id). Scheduling frequency is left to cron / the host.

    Returns:
        proceed — started or restarted a run
        proceed_reclaimed_stale — was stuck ``running``, lock reclaimed
        skip_running — another invocation still holds an active ``running`` row (not stale)
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT status FROM analysis_runs
            WHERE run_date = %s AND player_id = %s
            """,
            (run_date, player_id),
        )
        row = cur.fetchone()

    if row and row[0] == "running":
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE analysis_runs
                SET status = 'running',
                    reason = NULL,
                    selected_game_id = NULL,
                    started_at = now(),
                    finished_at = NULL,
                    metadata = COALESCE(metadata, '{}'::jsonb)
                        || '{"reclaimed_stale_lock": true}'::jsonb
                WHERE run_date = %s AND player_id = %s
                  AND status = 'running'
                  AND started_at < now() - (%s * interval '1 minute')
                """,
                (run_date, player_id, stale_minutes),
            )
            reclaimed = cur.rowcount > 0
        if reclaimed:
            return "proceed_reclaimed_stale"
        return "skip_running"

    with conn.cursor() as cur:
        if row is None:
            cur.execute(
                """
                INSERT INTO analysis_runs (run_date, player_id, status)
                VALUES (%s, %s, 'running')
                """,
                (run_date, player_id),
            )
        else:
            cur.execute(
                """
                UPDATE analysis_runs
                SET status = 'running',
                    reason = NULL,
                    selected_game_id = NULL,
                    started_at = now(),
                    finished_at = NULL,
                    metadata = '{}'::jsonb
                WHERE run_date = %s AND player_id = %s
                """,
                (run_date, player_id),
            )

    return "proceed"


def finish_analysis_run(
    conn: Connection,
    run_date: date,
    player_id: int,
    status: str,
    reason: str | None = None,
    selected_game_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    extra = Json(metadata or {})
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE analysis_runs
            SET status = %s,
                reason = %s,
                selected_game_id = %s,
                finished_at = now(),
                metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
            WHERE run_date = %s AND player_id = %s
            """,
            (status, reason, selected_game_id, extra, run_date, player_id),
        )


def newest_stored_game_end(conn: Connection, player_id: int) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(g.end_time)
            FROM player_games pg
            INNER JOIN chesscom_games g ON g.id = pg.game_id
            WHERE pg.player_id = %s
              AND g.end_time IS NOT NULL
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
    archive_months: int,
    max_sync_games: int,
    skip_fetch_if_fresh_within_days: int,
    log: Callable[[str], None],
) -> int:
    """
    Upsert recent Chess.com games. Skips HTTP fetch if the newest game already stored
    for this player ended within skip_fetch_if_fresh_within_days (0 = always fetch).
    """
    if skip_fetch_if_fresh_within_days > 0:
        now = datetime.now(timezone.utc)
        threshold = now - timedelta(days=skip_fetch_if_fresh_within_days)
        newest = newest_stored_game_end(conn, player_id)
        if newest is not None and newest >= threshold:
            log(
                f"skip Chess.com sync player_id={player_id}: newest stored game ended "
                f"{newest.isoformat()} (within last {skip_fetch_if_fresh_within_days} days)"
            )
            return 0
        if newest is not None:
            log(
                f"Chess.com sync player_id={player_id}: newest stored game "
                f"{newest.isoformat()} is older than fresh window (before {threshold.isoformat()}); fetching"
            )
        else:
            log(f"Chess.com sync player_id={player_id}: no stored games; fetching")

    games = client.recent_games(username, archive_months)
    if max_sync_games > 0:
        games = games[:max_sync_games]
    total = len(games)
    for i, g in enumerate(games):
        upsert_game_and_players(conn, player_id, username, g)
        if total and (i + 1) % 25 == 0:
            log(f"Chess.com sync player_id={player_id}: upserted {i + 1}/{total} games")
    log(f"Chess.com sync player_id={player_id}: upserted {total} games")
    return total


def upsert_game_and_players(
    conn: Connection,
    tracked_player_id: int,
    tracked_username: str,
    game: ChessComGame,
) -> int:
    white_u = str(game.white.get("username", "")).strip()
    black_u = str(game.black.get("username", "")).strip()

    eco_raw = game.raw.get("eco")
    eco_url_clean = eco_raw.strip() if isinstance(eco_raw, str) and eco_raw.strip() else None

    end_ts = game.end_time
    end_dt = datetime.fromtimestamp(end_ts, tz=timezone.utc) if end_ts else None

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO chesscom_games (
                chesscom_url, white_username, black_username,
                white_rating, black_rating, white_result, black_result,
                end_time, time_class, time_control, rules, rated, eco_url, pgn, raw_json
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
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

    tracked_u_lower = tracked_username.lower()
    if white_u.lower() == tracked_u_lower:
        side = "white"
        result = str(game.white.get("result", ""))
        rating_after = game.white.get("rating")
        opp_pid = None
    elif black_u.lower() == tracked_u_lower:
        side = "black"
        result = str(game.black.get("result", ""))
        rating_after = game.black.get("rating")
        opp_pid = None
    else:
        return game_id

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO player_games (player_id, game_id, side, result, rating_after, opponent_player_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (player_id, game_id) DO UPDATE SET
                side = EXCLUDED.side,
                result = EXCLUDED.result,
                rating_after = EXCLUDED.rating_after,
                opponent_player_id = EXCLUDED.opponent_player_id
            """,
            (tracked_player_id, game_id, side, result, rating_after, opp_pid),
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
        row = cur.fetchone()
        opening_id = int(row[0])

        cur.execute(
            """
            INSERT INTO game_openings (game_id, opening_id, source)
            VALUES (%s, %s, 'chesscom_eco')
            ON CONFLICT (game_id, opening_id, source) DO NOTHING
            """,
            (game_id, opening_id),
        )


def pick_random_unanalyzed_loss(
    conn: Connection,
    player_id: int,
    depth: int,
    multipv: int,
    heuristic_version: int,
) -> dict[str, Any] | None:
    loss_list = sorted(LOSS_RESULTS)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT g.id AS game_id, g.pgn, g.chesscom_url, pg.side
            FROM player_games pg
            JOIN chesscom_games g ON g.id = pg.game_id
            LEFT JOIN game_analyses ga
              ON ga.game_id = pg.game_id
             AND ga.player_id = pg.player_id
             AND ga.stockfish_depth = %s
             AND ga.stockfish_multipv = %s
             AND ga.heuristic_version = %s
            WHERE pg.player_id = %s
              AND pg.result = ANY(%s)
              AND g.rules = 'chess'
              AND g.pgn IS NOT NULL AND g.pgn <> ''
              AND ga.id IS NULL
            ORDER BY random()
            LIMIT 1
            """,
            (depth, multipv, heuristic_version, player_id, loss_list),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def insert_game_analysis(
    conn: Connection,
    game_id: int,
    player_id: int,
    stockfish_api_url: str,
    depth: int,
    multipv: int,
    heuristic_version: int,
    server_schema_version: int,
    summary_json: dict[str, Any],
    engine_analysis_json: dict[str, Any],
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO game_analyses (
                game_id, player_id, stockfish_depth, stockfish_multipv, stockfish_api_url,
                heuristic_version, server_schema_version, summary_json, engine_analysis_json
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                game_id,
                player_id,
                depth,
                multipv,
                stockfish_api_url,
                heuristic_version,
                server_schema_version,
                Json(summary_json),
                Json(engine_analysis_json),
            ),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("insert game_analyses failed")
        return int(row[0])


def insert_move_analyses(conn: Connection, game_analysis_id: int, moves: list[dict[str, Any]]) -> None:
    if not moves:
        return
    rows: list[tuple[Any, ...]] = []
    for m in moves:
        rows.append(
            (
                game_analysis_id,
                m["ply"],
                m["move_number"],
                m["side"],
                m["move"],
                m["san"],
                m["classification"],
                m.get("centipawn_loss"),
                m.get("evaluation_before_cp"),
                m.get("evaluation_after_cp"),
                m.get("evaluation_change_cp"),
                m.get("played_rank"),
                Json(m.get("top_moves") or []),
                m.get("fen_before"),
                m.get("fen_after"),
            )
        )
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO move_analyses (
                game_analysis_id, ply, move_number, side, move_uci, san, classification,
                centipawn_loss, evaluation_before_cp, evaluation_after_cp, evaluation_change_cp,
                played_rank, top_moves, fen_before, fen_after
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )


def build_player_summary(engine_moves: list[dict[str, Any]], player_side: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for m in engine_moves:
        if m.get("side") != player_side:
            continue
        c = m.get("classification") or "unknown"
        counts[c] = counts.get(c, 0) + 1
    return counts


def merge_summary_for_storage(engine_result: dict[str, Any], player_side: str) -> dict[str, Any]:
    moves = engine_result.get("moves") or []
    return {
        "engine_summary": engine_result.get("summary") or {},
        "player_side": player_side,
        "player_move_counts": build_player_summary(moves, player_side),
    }
