"""Pipeline stages, each a self-contained, DB-driven step.

Every stage opens its own short-lived connection(s) and returns a JSON-able
dict, so each maps cleanly onto an independent job / Lambda handler:

    ingest   -> sync Chess.com games as 'ingested'
    select   -> claim one 'ingested' loss -> 'selected'   (swappable policy)
    analyze  -> claim one 'selected' -> engine -> 'analyzed'
    generate -> claim one 'analyzed' -> cook -> 'puzzled' | 'no_puzzle'

Claiming flips the row to a transient state ('analyzing'/'generating') and
commits immediately, so no row lock is held across a long engine call.
Concurrent workers are safe via FOR UPDATE SKIP LOCKED.
"""

from __future__ import annotations

from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

from chesspipe.analyze.repository import (
    insert_game_analysis,
    insert_move_analyses,
    merge_summary_for_storage,
)
from chesspipe.config import Settings
from chesspipe.db import get_connection
from chesspipe.engine import build_engine, engine_identity
from chesspipe.ingest.chesscom import ChessComClient
from chesspipe.ingest.repository import get_target_player, sync_recent_games
from chesspipe.log import log
from chesspipe.puzzle.build import cook_record, load_move_rows
from chesspipe.puzzle.lichess import GeneratorConfig, LichessStyleGenerator
from chesspipe.puzzle.repository import insert_puzzle


# --------------------------------------------------------------------------- #
# state-machine helpers
# --------------------------------------------------------------------------- #
def _set_status(conn: Connection, player_game_id: int, status: str, detail: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE player_games
            SET status = %s, status_detail = %s, status_updated_at = now()
            WHERE id = %s
            """,
            (status, detail, player_game_id),
        )


def _claim(conn: Connection, from_status: str, to_status: str, player_id: int | None) -> dict[str, Any] | None:
    """Atomically move one oldest row from ``from_status`` to ``to_status``."""
    where_player = "AND player_id = %s" if player_id else ""
    params: list[Any] = [to_status, from_status]
    if player_id:
        params.append(player_id)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            UPDATE player_games
            SET status = %s, status_updated_at = now()
            WHERE id = (
                SELECT id FROM player_games
                WHERE status = %s {where_player}
                ORDER BY status_updated_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, game_id, player_id, side
            """,
            tuple(params),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def _game_pgn(conn: Connection, game_id: int) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT pgn FROM chesscom_games WHERE id = %s", (game_id,))
        row = cur.fetchone()
        return row[0] if row else None


def _game_analysis_input(conn: Connection, player_game_id: int) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT ga.id AS game_analysis_id, ga.game_id,
                   ga.player_id AS source_player_id, g.pgn
            FROM game_analyses ga
            JOIN chesscom_games g ON g.id = ga.game_id
            WHERE ga.player_game_id = %s
            """,
            (player_game_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


# --------------------------------------------------------------------------- #
# stages
# --------------------------------------------------------------------------- #
def ingest_stage(settings: Settings) -> dict[str, Any]:
    with get_connection(settings.database_url, settings.db_schema) as conn:
        player = get_target_player(conn, settings.target_user_id)
        if player is None:
            return {
                "stage": "ingest",
                "status": "error",
                "reason": "target_user_not_found_or_missing_chessdotcom_id",
            }
        client = ChessComClient(settings.user_agent)
        upserted = sync_recent_games(
            conn,
            client,
            int(player["id"]),
            str(player["username"]),
            archive_months=settings.recent_archive_months,
            max_sync_games=settings.max_sync_games,
            skip_fetch_if_fresh_within_days=settings.chesscom_sync_fresh_days,
            log=log,
        )
        conn.commit()
    return {"stage": "ingest", "status": "ok", "player_id": int(player["id"]), "upserted": upserted}


def select_stage(settings: Settings, limit: int = 1) -> dict[str, Any]:
    """Selection policy: pick unanalyzed losses (standard chess) at random.

    Kept deliberately separate so the policy can evolve (e.g. weight by rating
    swing or opening) without touching the analyze stage.
    """
    selected: list[dict[str, Any]] = []
    with get_connection(settings.database_url, settings.db_schema) as conn:
        for _ in range(max(1, limit)):
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    """
                    UPDATE player_games
                    SET status = 'selected', status_updated_at = now()
                    WHERE id = (
                        SELECT pg.id
                        FROM player_games pg
                        JOIN chesscom_games g ON g.id = pg.game_id
                        WHERE pg.player_id = %s
                          AND pg.status = 'ingested'
                          AND pg.is_loss
                          AND g.rules = 'chess'
                          AND g.pgn IS NOT NULL AND g.pgn <> ''
                        ORDER BY random()
                        FOR UPDATE OF pg SKIP LOCKED
                        LIMIT 1
                    )
                    RETURNING id, game_id
                    """,
                    (settings.target_user_id,),
                )
                row = cur.fetchone()
            if row is None:
                break
            conn.commit()
            selected.append({"player_game_id": int(row["id"]), "game_id": int(row["game_id"])})
    return {"stage": "select", "status": "ok", "selected": selected, "count": len(selected)}


def analyze_stage(settings: Settings) -> dict[str, Any]:
    with get_connection(settings.database_url, settings.db_schema) as conn:
        claim = _claim(conn, "selected", "analyzing", settings.target_user_id)
        conn.commit()
        if claim is None:
            return {"stage": "analyze", "status": "idle", "reason": "no_selected_game"}
        pgn = _game_pgn(conn, int(claim["game_id"]))

    pg_id = int(claim["id"])
    if not pgn:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            _set_status(conn, pg_id, "failed", "missing_pgn")
            conn.commit()
        return {"stage": "analyze", "status": "failed", "player_game_id": pg_id, "reason": "missing_pgn"}

    log(f"analyze: player_game={pg_id} game_id={claim['game_id']} depth={settings.analysis_depth}")
    engine = build_engine(settings)
    try:
        engine.health()
        result = engine.analyse_game(pgn, settings.analysis_depth, settings.analysis_multipv)
    except Exception as exc:  # noqa: BLE001
        log(f"analyze: player_game={pg_id} failed: {exc}")
        with get_connection(settings.database_url, settings.db_schema) as conn:
            _set_status(conn, pg_id, "failed", str(exc)[:500])
            conn.commit()
        return {"stage": "analyze", "status": "failed", "player_game_id": pg_id, "error": str(exc)}
    finally:
        engine.close()

    with get_connection(settings.database_url, settings.db_schema) as conn:
        summary = merge_summary_for_storage(result, str(claim["side"]))
        ga_id = insert_game_analysis(
            conn,
            player_game_id=pg_id,
            game_id=int(claim["game_id"]),
            player_id=int(claim["player_id"]),
            engine_id=engine_identity(settings),
            depth=settings.analysis_depth,
            multipv=settings.analysis_multipv,
            summary_json=summary,
            engine_analysis_json=result,
        )
        insert_move_analyses(conn, ga_id, result.get("moves") or [])
        _set_status(conn, pg_id, "analyzed")
        conn.commit()

    log(f"analyze: player_game={pg_id} -> analyzed (game_analysis={ga_id})")
    return {"stage": "analyze", "status": "ok", "player_game_id": pg_id, "game_analysis_id": ga_id}


def generate_stage(settings: Settings) -> dict[str, Any]:
    with get_connection(settings.database_url, settings.db_schema) as conn:
        claim = _claim(conn, "analyzed", "generating", settings.target_user_id)
        conn.commit()
        if claim is None:
            return {"stage": "generate", "status": "idle", "reason": "no_analyzed_game"}
        pg_id = int(claim["id"])
        game = _game_analysis_input(conn, pg_id)
        move_rows = load_move_rows(conn, int(game["game_analysis_id"])) if game else []

    if game is None:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            _set_status(conn, pg_id, "failed", "missing_game_analysis")
            conn.commit()
        return {"stage": "generate", "status": "failed", "player_game_id": pg_id, "reason": "missing_game_analysis"}

    log(f"generate: player_game={pg_id} cooking (depth={settings.cook_depth}, {settings.cook_time_sec}s/pos)")
    engine = build_engine(settings)
    try:
        engine.health()
        generator = LichessStyleGenerator(engine, GeneratorConfig())
        record = cook_record(generator, game, move_rows)
    except Exception as exc:  # noqa: BLE001
        log(f"generate: player_game={pg_id} failed: {exc}")
        with get_connection(settings.database_url, settings.db_schema) as conn:
            _set_status(conn, pg_id, "failed", str(exc)[:500])
            conn.commit()
        return {"stage": "generate", "status": "failed", "player_game_id": pg_id, "error": str(exc)}
    finally:
        engine.close()

    with get_connection(settings.database_url, settings.db_schema) as conn:
        if record is None:
            _set_status(conn, pg_id, "no_puzzle")
            conn.commit()
            log(f"generate: player_game={pg_id} -> no_puzzle")
            return {"stage": "generate", "status": "no_puzzle", "player_game_id": pg_id}
        insert_puzzle(conn, record)
        _set_status(conn, pg_id, "puzzled")
        conn.commit()

    log(f"generate: player_game={pg_id} -> puzzled ({record['tag']}, {len(record['solution_line_uci'])}-ply)")
    return {
        "stage": "generate",
        "status": "ok",
        "player_game_id": pg_id,
        "tag": record["tag"],
        "solution_san": record["solution_san"],
    }


def run_pipeline(settings: Settings) -> dict[str, Any]:
    """Convenience: ingest -> select one -> analyze one -> generate one."""
    steps = [
        ingest_stage(settings),
        select_stage(settings, limit=1),
        analyze_stage(settings),
        generate_stage(settings),
    ]
    return {"status": "ok", "steps": steps}
