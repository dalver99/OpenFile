from __future__ import annotations

from typing import Any

import chess
from psycopg import Connection
from psycopg.rows import dict_row

from analysis_cron.puzzles.heuristics import (
    classify_phase,
    classify_tag,
    extract_solution_uci,
    extract_top_scores,
    is_quality_puzzle,
)


def _candidate_rows(conn: Connection) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
                ma.id AS move_analysis_id,
                ma.game_analysis_id,
                ga.game_id,
                ga.player_id AS source_player_id,
                ma.fen_before,
                ma.move_uci AS last_move_uci,
                ma.san AS last_move_san,
                ma.side,
                ma.centipawn_loss,
                ma.top_moves
            FROM move_analyses ma
            JOIN game_analyses ga ON ga.id = ma.game_analysis_id
            LEFT JOIN puzzles p ON p.move_analysis_id = ma.id
            WHERE p.id IS NULL
              AND ga.stockfish_multipv >= 2
              AND ma.fen_before IS NOT NULL
              AND ma.top_moves IS NOT NULL
            """
        )
        return list(cur.fetchall())


def generate_pending_puzzles(
    conn: Connection,
    *,
    min_centipawn_loss: int = 150,
    min_top_score_gap_cp: int = 15,
) -> int:
    inserted = 0
    for row in _candidate_rows(conn):
        if not is_quality_puzzle(
            row,
            min_centipawn_loss=min_centipawn_loss,
            min_top_score_gap_cp=min_top_score_gap_cp,
        ):
            continue

        fen = row.get("fen_before")
        if not isinstance(fen, str) or not fen.strip():
            continue

        try:
            board = chess.Board(fen)
        except ValueError:
            continue

        top_moves = row.get("top_moves")
        if not isinstance(top_moves, list):
            continue

        solution_uci = extract_solution_uci(top_moves)
        if not solution_uci:
            continue

        phase = classify_phase(board)
        best_line = top_moves[0] if top_moves and isinstance(top_moves[0], dict) else {}
        tag = classify_tag(board, best_line)
        top1_cp, top2_cp = extract_top_scores(top_moves)
        side_to_move = "white" if board.turn == chess.WHITE else "black"

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO puzzles (
                    move_analysis_id, game_analysis_id, game_id, source_player_id,
                    fen_before, last_move_uci, solution_uci, solution_san, side_to_move,
                    phase, tag, cp_loss, top1_cp, top2_cp
                )
                VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s
                )
                ON CONFLICT (move_analysis_id) DO NOTHING
                """,
                (
                    int(row["move_analysis_id"]),
                    int(row["game_analysis_id"]),
                    int(row["game_id"]),
                    int(row["source_player_id"]),
                    fen,
                    row.get("last_move_uci"),
                    solution_uci,
                    None,
                    side_to_move,
                    phase,
                    tag,
                    int(row["centipawn_loss"]),
                    top1_cp,
                    top2_cp,
                ),
            )
            if cur.rowcount > 0:
                inserted += 1
    return inserted

