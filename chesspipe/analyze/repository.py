from __future__ import annotations

import json
from typing import Any

from chesspipe.storage import Connection


def build_player_summary(engine_moves: list[dict[str, Any]], player_side: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for move in engine_moves:
        if move.get("side") != player_side:
            continue
        category = move.get("classification") or "unknown"
        counts[category] = counts.get(category, 0) + 1
    return counts


def merge_summary_for_storage(engine_result: dict[str, Any], player_side: str) -> dict[str, Any]:
    moves = engine_result.get("moves") or []
    return {
        "engine_summary": engine_result.get("summary") or {},
        "player_side": player_side,
        "player_move_counts": build_player_summary(moves, player_side),
    }


def insert_game_analysis(
    conn: Connection,
    *,
    player_game_id: int,
    game_id: int,
    player_id: int,
    engine_id: str,
    depth: int,
    multipv: int,
    summary_json: dict[str, Any],
    engine_analysis_json: dict[str, Any],
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO game_analyses (
                player_game_id, game_id, player_id, engine_id, depth, multipv,
                summary_json, engine_analysis_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (player_game_id) DO UPDATE SET
                engine_id = EXCLUDED.engine_id,
                depth = EXCLUDED.depth,
                multipv = EXCLUDED.multipv,
                summary_json = EXCLUDED.summary_json,
                engine_analysis_json = EXCLUDED.engine_analysis_json
            RETURNING id
            """,
            (
                player_game_id,
                game_id,
                player_id,
                engine_id,
                depth,
                multipv,
                json.dumps(summary_json),
                json.dumps(engine_analysis_json),
            ),
        )
        return int(cur.fetchone()[0])


def insert_move_analyses(
    conn: Connection, game_analysis_id: int, moves: list[dict[str, Any]]
) -> None:
    if not moves:
        return
    rows = [
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
            json.dumps(m.get("top_moves") or []),
            m.get("fen_before"),
            m.get("fen_after"),
        )
        for m in moves
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO move_analyses (
                game_analysis_id, ply, move_number, side, move_uci, san, classification,
                centipawn_loss, evaluation_before_cp, evaluation_after_cp, evaluation_change_cp,
                played_rank, top_moves, fen_before, fen_after
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (game_analysis_id, ply) DO UPDATE SET
                move_number = EXCLUDED.move_number,
                side = EXCLUDED.side,
                move_uci = EXCLUDED.move_uci,
                san = EXCLUDED.san,
                classification = EXCLUDED.classification,
                centipawn_loss = EXCLUDED.centipawn_loss,
                evaluation_before_cp = EXCLUDED.evaluation_before_cp,
                evaluation_after_cp = EXCLUDED.evaluation_after_cp,
                evaluation_change_cp = EXCLUDED.evaluation_change_cp,
                played_rank = EXCLUDED.played_rank,
                top_moves = EXCLUDED.top_moves,
                fen_before = EXCLUDED.fen_before,
                fen_after = EXCLUDED.fen_after
            """,
            rows,
        )
