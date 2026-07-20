"""Pipeline stages, each a self-contained, DB-driven step.

Every stage opens its own short-lived connection(s) and returns a JSON-able
dict, so each maps cleanly onto an independent job / Lambda handler:

    ingest   -> sync Chess.com games as 'ingested'
    select   -> claim one 'ingested' game -> 'selected'   (swappable policy)
    analyze  -> claim one 'selected' -> engine -> 'analyzed'
    generate -> claim one 'analyzed' -> cook -> 'puzzled' | 'no_puzzle'

Claiming flips the row to a transient state ('analyzing'/'generating') and
commits immediately, so no row lock is held across a long engine call.
SQLite serializes the short claim transaction; engine work runs after commit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from chesspipe.analyze.repository import (
    insert_game_analysis,
    insert_move_analyses,
    merge_summary_for_storage,
)
from chesspipe.config import Settings
from chesspipe.storage import Connection, get_connection
from chesspipe.engine import build_engine, engine_identity
from chesspipe.ingest.chesscom import ChessComClient, normalize_game_url
from chesspipe.ingest.repository import get_target_player, sync_recent_games, upsert_game_and_player
from chesspipe.ingest.runs import create_sync_run, record_sync_game, update_sync_run
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
            SET status = ?, status_detail = ?, status_updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (status, detail, player_game_id),
        )


def _set_analysis_detail(settings: Settings, player_game_id: int, detail: str) -> None:
    """Publish a coarse, truthful phase for the web review poller."""
    with get_connection(settings.database_url, settings.db_schema) as conn:
        _set_status(conn, player_game_id, "analyzing", detail)
        conn.commit()


def _claim(conn: Connection, from_status: str, to_status: str, player_id: int | None) -> dict[str, Any] | None:
    """Atomically move one oldest row from ``from_status`` to ``to_status``."""
    where_player = "AND player_id = ?" if player_id else ""
    params: list[Any] = [to_status, from_status]
    if player_id:
        params.append(player_id)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE player_games
            SET status = ?, status_updated_at = CURRENT_TIMESTAMP
            WHERE id = (
                SELECT id FROM player_games
                WHERE status = ? {where_player}
                ORDER BY status_updated_at ASC
                LIMIT 1
            )
            RETURNING id, game_id, player_id, side
            """,
            tuple(params),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def _claim_specific_analysis(
    conn: Connection, player_game_id: int, player_id: int, *, force: bool = False
) -> dict[str, Any] | None:
    """Claim one explicitly requested game for on-demand review analysis."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE player_games
            SET status = 'analyzing', status_detail = 'engine_starting', status_updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND player_id = ?
              AND status NOT IN ('analyzing', 'generating')
              AND (
                  ? = 1
                  OR (
                      status IN ('ingested', 'selected', 'failed')
                      AND NOT EXISTS (
                          SELECT 1 FROM game_analyses ga WHERE ga.player_game_id = player_games.id
                      )
                  )
              )
            RETURNING id, game_id, player_id, side
            """,
            (player_game_id, player_id, 1 if force else 0),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def _existing_analysis_id(conn: Connection, player_game_id: int, player_id: int) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ga.id
            FROM game_analyses ga
            WHERE ga.player_game_id = ? AND ga.player_id = ?
            """,
            (player_game_id, player_id),
        )
        row = cur.fetchone()
        return int(row[0]) if row else None


def _player_game_status(conn: Connection, player_game_id: int, player_id: int) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status FROM player_games WHERE id = ? AND player_id = ?",
            (player_game_id, player_id),
        )
        row = cur.fetchone()
        return str(row[0]) if row else None


def _game_pgn(conn: Connection, game_id: int) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT pgn FROM chesscom_games WHERE id = ?", (game_id,))
        row = cur.fetchone()
        return row[0] if row else None


def _game_analysis_input(conn: Connection, player_game_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ga.id AS game_analysis_id, ga.game_id,
                   ga.player_id AS source_player_id, g.pgn,
                   g.time_class, g.end_time AS played_at,
                   CASE WHEN pg.side = 'white' THEN g.black_username ELSE g.white_username END
                       AS opponent_username
            FROM game_analyses ga
            JOIN chesscom_games g ON g.id = ga.game_id
            JOIN player_games pg ON pg.game_id = ga.game_id AND pg.player_id = ga.player_id
            WHERE ga.player_game_id = ?
            """,
            (player_game_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


# --------------------------------------------------------------------------- #
# stages
# --------------------------------------------------------------------------- #
def ingest_stage(
    settings: Settings,
    *,
    force: bool = False,
    archive_months: int | None = None,
    max_sync_games: int | None = None,
    sync_run_id: int | None = None,
) -> dict[str, Any]:
    months = max(1, min(24, archive_months or settings.recent_archive_months))
    max_games = max(10, min(2_000, max_sync_games or settings.max_sync_games))
    with get_connection(settings.database_url, settings.db_schema) as conn:
        player = get_target_player(conn, settings.target_user_id)
        if player is None:
            return {
                "stage": "ingest",
                "status": "error",
                "reason": "target_user_not_found_or_missing_chessdotcom_id",
            }
        run_id = sync_run_id or create_sync_run(
            conn,
            user_id=int(player["id"]),
            archive_months=months,
            max_games=max_games,
            refresh_existing=force,
        )
        update_sync_run(conn, run_id, phase="connecting")
        conn.commit()

        def report(phase: str, values: dict[str, int]) -> None:
            update_sync_run(conn, run_id, phase=phase, **values)
            conn.commit()

        def record_game(player_game_id: int, time_class: str | None) -> None:
            record_sync_game(conn, run_id, player_game_id, time_class)

        client = ChessComClient(settings.user_agent)
        try:
            sync = sync_recent_games(
                conn,
                client,
                int(player["id"]),
                str(player["username"]),
                archive_months=months,
                max_sync_games=max_games,
                refresh_existing=force,
                log=log,
                progress=report,
                record_new_game=record_game,
            )
        except Exception as exc:  # noqa: BLE001
            update_sync_run(
                conn,
                run_id,
                status="failed",
                phase="failed",
                error=str(exc)[:1_000],
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
            conn.commit()
            return {
                "stage": "ingest",
                "status": "error",
                "sync_run_id": run_id,
                "reason": str(exc),
            }
        update_sync_run(
            conn,
            run_id,
            status="complete",
            phase="complete",
            checked=sync["fetched"],
            added=sync["added"],
            existing_count=sync["existing"],
            processed=sync["upserted"],
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        conn.commit()
    return {
        "stage": "ingest",
        "status": "ok",
        "sync_run_id": run_id,
        "player_id": int(player["id"]),
        **sync,
        "forced": force,
        "archive_months": months,
        "max_sync_games": max_games,
    }


def import_game_stage(settings: Settings, game_url: str) -> dict[str, Any]:
    """Import one game link for the configured Chess.com player."""
    try:
        normalized_url = normalize_game_url(game_url)
    except ValueError as exc:
        return {"stage": "import_game", "status": "error", "reason": str(exc)}

    with get_connection(settings.database_url, settings.db_schema) as conn:
        player = get_target_player(conn, settings.target_user_id)
        if player is None:
            return {
                "stage": "import_game",
                "status": "error",
                "reason": "target_user_not_found_or_missing_chessdotcom_id",
            }
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pg.id
                FROM player_games pg
                JOIN chesscom_games g ON g.id = pg.game_id
                WHERE pg.player_id = ? AND g.chesscom_url = ?
                """,
                (int(player["id"]), normalized_url),
            )
            existing = cur.fetchone()
        if existing is not None:
            return {
                "stage": "import_game",
                "status": "ok",
                "player_game_id": int(existing[0]),
                "game_url": normalized_url,
                "existing": True,
            }

        client = ChessComClient(settings.user_agent)
        try:
            game = client.game_by_url(str(player["username"]), normalized_url)
        except Exception as exc:  # noqa: BLE001
            return {"stage": "import_game", "status": "error", "reason": str(exc)}
        if game is None:
            return {
                "stage": "import_game",
                "status": "error",
                "reason": "Game not found in the configured player's public Chess.com archives.",
            }
        player_game_id = upsert_game_and_player(
            conn,
            int(player["id"]),
            str(player["username"]),
            game,
        )
        conn.commit()
    return {
        "stage": "import_game",
        "status": "ok",
        "player_game_id": player_game_id,
        "game_url": normalized_url,
        "existing": False,
    }


def select_stage(settings: Settings, limit: int = 1) -> dict[str, Any]:
    """Selection policy: pick any unanalyzed game (standard chess) at random.

    Not restricted to losses — wins and draws have mistakes worth drilling too.
    Kept deliberately separate so the policy can evolve (e.g. weight by rating
    swing or opening) without touching the analyze stage.
    """
    selected: list[dict[str, Any]] = []
    with get_connection(settings.database_url, settings.db_schema) as conn:
        for _ in range(max(1, limit)):
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE player_games
                    SET status = 'selected', status_updated_at = CURRENT_TIMESTAMP
                    WHERE id = (
                        SELECT pg.id
                        FROM player_games pg
                        JOIN chesscom_games g ON g.id = pg.game_id
                        WHERE pg.player_id = ?
                          AND pg.status = 'ingested'
                          AND g.rules = 'chess'
                          AND g.pgn IS NOT NULL AND g.pgn <> ''
                        ORDER BY random()
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


def _analyze_claim(settings: Settings, claim: dict[str, Any]) -> dict[str, Any]:
    pg_id = int(claim["id"])
    with get_connection(settings.database_url, settings.db_schema) as conn:
        pgn = _game_pgn(conn, int(claim["game_id"]))

    if not pgn:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            _set_status(conn, pg_id, "failed", "missing_pgn")
            conn.commit()
        return {"stage": "analyze", "status": "failed", "player_game_id": pg_id, "reason": "missing_pgn"}

    log(
        f"analyze: player_game={pg_id} game_id={claim['game_id']} "
        f"base=depth{settings.analysis_depth}/pv{settings.analysis_multipv} "
        f"deep=depth{settings.analysis_deep_depth}/pv{settings.analysis_deep_multipv} "
        f"threshold={settings.analysis_deep_threshold_cp}cp "
        f"max_deep_moves={settings.analysis_deep_max_moves}"
    )
    engine = build_engine(settings)
    try:
        _set_analysis_detail(settings, pg_id, "engine_starting")
        engine.health()
        _set_analysis_detail(settings, pg_id, "analyzing_positions")
        result = engine.analyse_game(pgn, settings.analysis_depth, settings.analysis_multipv)
        _set_analysis_detail(settings, pg_id, "saving_review")
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


def analyze_stage(settings: Settings) -> dict[str, Any]:
    with get_connection(settings.database_url, settings.db_schema) as conn:
        claim = _claim(conn, "selected", "analyzing", settings.target_user_id)
        conn.commit()
    if claim is None:
        return {"stage": "analyze", "status": "idle", "reason": "no_selected_game"}
    return _analyze_claim(settings, claim)


def analyze_game_stage(
    settings: Settings, player_game_id: int, *, force: bool = False
) -> dict[str, Any]:
    """Analyze one user-selected game, used by the web Game Review flow."""
    with get_connection(settings.database_url, settings.db_schema) as conn:
        existing_id = _existing_analysis_id(conn, player_game_id, settings.target_user_id)
        if existing_id is not None and not force:
            return {
                "stage": "analyze",
                "status": "ok",
                "reason": "already_analyzed",
                "player_game_id": player_game_id,
                "game_analysis_id": existing_id,
            }

        claim = _claim_specific_analysis(
            conn,
            player_game_id,
            settings.target_user_id,
            force=force,
        )
        conn.commit()
        if claim is None:
            current_status = _player_game_status(conn, player_game_id, settings.target_user_id)
            if current_status is None:
                return {
                    "stage": "analyze",
                    "status": "failed",
                    "player_game_id": player_game_id,
                    "reason": "game_not_found",
                }
            return {
                "stage": "analyze",
                "status": "idle",
                "player_game_id": player_game_id,
                "reason": "analysis_in_progress" if current_status == "analyzing" else "game_not_claimable",
                "game_status": current_status,
            }

    return _analyze_claim(settings, claim)


def generate_stage(
    settings: Settings,
    *,
    retry_no_puzzle: bool = False,
) -> dict[str, Any]:
    source_status = "no_puzzle" if retry_no_puzzle else "analyzed"
    with get_connection(settings.database_url, settings.db_schema) as conn:
        claim = _claim(
            conn,
            source_status,
            "generating",
            settings.target_user_id,
        )
        conn.commit()
        if claim is None:
            return {
                "stage": "generate",
                "status": "idle",
                "reason": f"no_{source_status}_game",
            }
        pg_id = int(claim["id"])
        game = _game_analysis_input(conn, pg_id)
        move_rows = load_move_rows(conn, int(game["game_analysis_id"])) if game else []

    if game is None:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            _set_status(conn, pg_id, "failed", "missing_game_analysis")
            conn.commit()
        return {"stage": "generate", "status": "failed", "player_game_id": pg_id, "reason": "missing_game_analysis"}

    log(
        f"generate: player_game={pg_id} cooking "
        f"(depth={settings.cook_depth}, {settings.cook_time_sec}s/pos, "
        f"max_candidates={settings.puzzle_max_candidates}, "
        f"max_line={settings.puzzle_max_solution_plies} plies, "
        f"fallback_min={settings.puzzle_fallback_min_plies})"
    )
    engine = build_engine(settings)
    generator = LichessStyleGenerator(
        engine,
        GeneratorConfig(
            max_candidates=settings.puzzle_max_candidates,
            max_solution_plies=settings.puzzle_max_solution_plies,
            fallback_min_solution_plies=(
                settings.puzzle_fallback_min_plies or None
            ),
            allow_mate_in_one=settings.puzzle_fallback_min_plies == 1,
        ),
    )
    try:
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
            log(
                f"generate: player_game={pg_id} -> no_puzzle "
                f"stats={generator.last_stats}"
            )
            return {
                "stage": "generate",
                "status": "no_puzzle",
                "player_game_id": pg_id,
                "stats": generator.last_stats,
            }
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
        "retried": retry_no_puzzle,
        "stats": generator.last_stats,
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
