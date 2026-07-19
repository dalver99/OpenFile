from __future__ import annotations

import json
from typing import Any

from chesspipe.storage import Connection


def insert_puzzle(conn: Connection, record: dict[str, Any]) -> bool:
    """Insert one puzzle record. Returns True if a row was created."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO puzzles (
                game_analysis_id, game_id, source_player_id, mistake_ply,
                fen_before, last_move_uci, solution_uci, solution_san, solution_line_uci,
                side_to_move, phase, tag, themes, cp_loss, is_mate, mate_in,
                difficulty, quality_score, time_class, opponent_username, played_at
            )
            VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?
            )
            ON CONFLICT (game_analysis_id, mistake_ply) DO NOTHING
            """,
            (
                record["game_analysis_id"],
                record["game_id"],
                record["source_player_id"],
                record["mistake_ply"],
                record["fen_before"],
                record["last_move_uci"],
                record["solution_uci"],
                record["solution_san"],
                json.dumps(record["solution_line_uci"]),
                record["side_to_move"],
                record["phase"],
                record["tag"],
                json.dumps(record["themes"]),
                record["cp_loss"],
                record["is_mate"],
                record["mate_in"],
                record["difficulty"],
                record["quality_score"],
                record.get("time_class"),
                record.get("opponent_username"),
                record.get("played_at"),
            ),
        )
        return cur.rowcount > 0
