from __future__ import annotations

from datetime import datetime
from typing import Any

from analysis_cron.chesscom import ChessComClient
from analysis_cron.config import Settings
from analysis_cron.db import get_connection
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
from analysis_cron.stockfish_client import StockfishClient


def run_daily_analysis(settings: Settings) -> dict[str, Any]:
    now = datetime.now(settings.timezone)
    run_date = now.date()
    outcomes: list[dict[str, Any]] = []

    with get_connection(settings.database_url, settings.db_schema) as conn:
        players = list_active_players(conn, settings.target_user_id)
        if not players:
            return {
                "status": "error",
                "reason": "target_user_not_found_or_missing_chessdotcom_id",
                "hint": "Ensure public.users has that user_id and chessdotcom_id.",
                "run_date": run_date.isoformat(),
            }

        chesscom = ChessComClient(settings.user_agent)
        stockfish = StockfishClient(settings.stockfish_api_url, settings.stockfish_api_key)
        stockfish.health()

        for player in players:
            pid = int(player["id"])
            username = str(player["username"])
            player_result: dict[str, Any] = {
                "player_id": pid,
                "username": username,
            }

            acquisition = acquire_daily_run(conn, run_date, pid)
            if acquisition == "skip_done":
                player_result["status"] = "skipped"
                player_result["reason"] = "already_finished_today"
                outcomes.append(player_result)
                conn.commit()
                continue
            if acquisition == "skip_running":
                player_result["status"] = "skipped"
                player_result["reason"] = "run_already_in_progress"
                outcomes.append(player_result)
                conn.commit()
                continue

            conn.commit()

            try:
                sync_recent_games(
                    conn,
                    chesscom,
                    pid,
                    username,
                    settings.recent_archive_months,
                )

                candidate = pick_random_unanalyzed_loss(
                    conn,
                    pid,
                    settings.stockfish_depth,
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
                    continue

                engine_json = stockfish.analyze_game(
                    candidate["pgn"],
                    settings.stockfish_depth,
                    settings.stockfish_multipv,
                )
                summary = merge_summary_for_storage(engine_json, candidate["side"])

                game_analysis_id = insert_game_analysis(
                    conn,
                    int(candidate["game_id"]),
                    pid,
                    settings.stockfish_api_url,
                    settings.stockfish_depth,
                    settings.stockfish_multipv,
                    settings.heuristic_version,
                    settings.server_schema_version,
                    summary,
                    engine_json,
                )
                insert_move_analyses(conn, game_analysis_id, engine_json.get("moves") or [])

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
                player_result["status"] = "completed"
                player_result["game_analysis_id"] = game_analysis_id
                player_result["game_id"] = int(candidate["game_id"])
                outcomes.append(player_result)
            except Exception as exc:
                conn.rollback()
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
                    conn.rollback()
                player_result["status"] = "failed"
                player_result["error"] = str(exc)
                outcomes.append(player_result)

    return {
        "status": "ok",
        "run_date": run_date.isoformat(),
        "players": outcomes,
    }
