from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from analysis_cron.chesscom import ChessComClient
from analysis_cron.config import MAX_ANALYZE_GAME_DEPTH, Settings
from analysis_cron.db import get_connection
from analysis_cron.engine import build_engine_client, engine_identity
from analysis_cron.repositories import (
    acquire_daily_run,
    finish_analysis_run,
    insert_game_analysis,
    insert_move_analyses,
    list_active_players,
    merge_summary_for_storage,
    pick_random_unanalyzed_loss,
    sync_recent_games,
)


def _log(message: str) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now} UTC] {message}", flush=True)


def _effective_depth(settings: Settings, override: int | None) -> int:
    raw = settings.stockfish_depth if override is None else override
    return min(max(raw, 1), MAX_ANALYZE_GAME_DEPTH)


def run_daily_analysis(
    settings: Settings,
    *,
    stockfish_depth: int | None = None,
) -> dict[str, Any]:
    depth = _effective_depth(settings, stockfish_depth)
    now = datetime.now(settings.timezone)
    run_date = now.date()
    outcomes: list[dict[str, Any]] = []
    _log(
        f"run started (date={run_date.isoformat()}, depth={depth}, multipv={settings.stockfish_multipv})"
        + (" [--depth override]" if stockfish_depth is not None else "")
    )

    with get_connection(settings.database_url, settings.db_schema) as conn:
        players = list_active_players(conn, settings.target_user_id)
        _log(f"active players found: {len(players)}")
        if not players:
            _log("no active target user with chessdotcom_id; aborting")
            return {
                "status": "error",
                "reason": "target_user_not_found_or_missing_chessdotcom_id",
                "hint": "Ensure public.users has that user_id and chessdotcom_id.",
                "run_date": run_date.isoformat(),
            }

        chesscom = ChessComClient(settings.user_agent)
        stockfish = build_engine_client(settings)
        _log(f"engine backend: {settings.stockfish_mode} ({engine_identity(settings)})")
        _log("checking stockfish health endpoint")
        stockfish.health()
        _log("stockfish health OK")

        for player in players:
            pid = int(player["id"])
            username = str(player["username"])
            _log(f"processing player user_id={pid} username={username}")
            player_result: dict[str, Any] = {
                "player_id": pid,
                "username": username,
            }

            acquisition = acquire_daily_run(
                conn,
                run_date,
                pid,
                stale_minutes=settings.analysis_run_stale_minutes,
            )
            if acquisition == "skip_running":
                _log(f"skip player={pid}: run already in progress")
                player_result["status"] = "skipped"
                player_result["reason"] = "run_already_in_progress"
                outcomes.append(player_result)
                conn.commit()
                continue
            if acquisition == "proceed_reclaimed_stale":
                _log(
                    f"player={pid}: reclaimed stale run lock "
                    f"(running longer than {settings.analysis_run_stale_minutes} minutes)"
                )

            conn.commit()

            try:
                _log(f"syncing recent games for {username}")
                upserted = sync_recent_games(
                    conn,
                    chesscom,
                    pid,
                    username,
                    settings.recent_archive_months,
                    settings.max_sync_games,
                    settings.chesscom_sync_fresh_days,
                    _log,
                )
                _log(
                    f"sync complete for {username} "
                    f"(upserted={upserted}, fresh_skip_days={settings.chesscom_sync_fresh_days}); "
                    "selecting candidate loss"
                )

                candidate = pick_random_unanalyzed_loss(
                    conn,
                    pid,
                    depth,
                    settings.stockfish_multipv,
                    settings.heuristic_version,
                )
                if candidate is None:
                    finish_analysis_run(
                        conn,
                        run_date,
                        pid,
                        "no_candidate",
                        reason="no_unanalyzed_loss_in_window",
                        metadata={"games_synced": True},
                    )
                    player_result["status"] = "no_candidate"
                    outcomes.append(player_result)
                    conn.commit()
                    _log(f"player={pid}: no unanalyzed loss candidate")
                    continue

                _log(
                    "candidate selected "
                    f"player={pid} game_id={int(candidate['game_id'])} url={candidate['chesscom_url']}"
                )
                conn.commit()
                _log(
                    "committed sync/candidate work; starting Stockfish (avoids idle-in-transaction timeout)"
                )
                _log("calling stockfish /analyze-game (this can take a while)")
                engine_json = stockfish.analyze_game(
                    candidate["pgn"],
                    depth,
                    settings.stockfish_multipv,
                )
                _log("stockfish analysis complete; storing game analysis")
                summary = merge_summary_for_storage(engine_json, candidate["side"])

                game_analysis_id = insert_game_analysis(
                    conn,
                    int(candidate["game_id"]),
                    pid,
                    engine_identity(settings),
                    depth,
                    settings.stockfish_multipv,
                    settings.heuristic_version,
                    settings.server_schema_version,
                    summary,
                    engine_json,
                )
                insert_move_analyses(conn, game_analysis_id, engine_json.get("moves") or [])
                _log(f"stored game_analysis_id={game_analysis_id} and move rows")

                finish_analysis_run(
                    conn,
                    run_date,
                    pid,
                    "completed",
                    selected_game_id=int(candidate["game_id"]),
                    metadata={
                        "game_analysis_id": game_analysis_id,
                        "chesscom_url": candidate["chesscom_url"],
                    },
                )
                conn.commit()
                _log(f"player={pid}: completed successfully")
                player_result["status"] = "completed"
                player_result["game_analysis_id"] = game_analysis_id
                player_result["game_id"] = int(candidate["game_id"])
                outcomes.append(player_result)
            except Exception as exc:
                _log(f"player={pid}: failed with error: {exc}")
                try:
                    conn.rollback()
                except Exception as rb_exc:
                    _log(f"player={pid}: rollback skipped ({rb_exc})")
                try:
                    finish_analysis_run(
                        conn,
                        run_date,
                        pid,
                        "failed",
                        reason=str(exc),
                    )
                    conn.commit()
                except Exception:
                    try:
                        with get_connection(settings.database_url, settings.db_schema) as conn2:
                            finish_analysis_run(
                                conn2,
                                run_date,
                                pid,
                                "failed",
                                reason=str(exc),
                            )
                            conn2.commit()
                    except Exception as fin_exc:
                        _log(f"player={pid}: could not persist failed run status: {fin_exc}")
                player_result["status"] = "failed"
                player_result["error"] = str(exc)
                outcomes.append(player_result)

    _log("run finished")
    return {
        "status": "ok",
        "run_date": run_date.isoformat(),
        "players": outcomes,
    }
