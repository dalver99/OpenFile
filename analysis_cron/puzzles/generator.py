from __future__ import annotations

from typing import Any

import chess
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from analysis_cron.puzzles.phase import classify_phase
from analysis_cron.puzzles.quality import QualityConfig, evaluate_quality
from analysis_cron.puzzles.scoring import parse_lines
from analysis_cron.puzzles.themes import detect_themes


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
                ma.centipawn_loss,
                ma.top_moves,
                prev.move_uci AS prev_move_uci
            FROM move_analyses ma
            JOIN game_analyses ga ON ga.id = ma.game_analysis_id
            LEFT JOIN puzzles p ON p.move_analysis_id = ma.id
            LEFT JOIN move_analyses prev
                   ON prev.game_analysis_id = ma.game_analysis_id
                  AND prev.ply = ma.ply - 1
            WHERE p.id IS NULL
              AND ga.stockfish_multipv >= 2
              AND ma.fen_before IS NOT NULL
              AND ma.top_moves IS NOT NULL
              AND ma.centipawn_loss IS NOT NULL
            """
        )
        return list(cur.fetchall())


def _is_recapture(prev_move_uci: Any, solution_move: chess.Move, is_capture: bool) -> bool:
    """True when the solution simply recaptures on the square the opponent just used."""
    if not is_capture or not isinstance(prev_move_uci, str) or not prev_move_uci.strip():
        return False
    try:
        prev = chess.Move.from_uci(prev_move_uci.strip())
    except ValueError:
        return False
    return prev.to_square == solution_move.to_square


def evaluate_candidate(
    row: dict[str, Any],
    config: QualityConfig,
) -> tuple[dict[str, Any] | None, str | None]:
    """Assess a single candidate move row.

    Returns ``(record, None)`` for a quality puzzle (a dict of all puzzle
    fields ready to store or display), or ``(None, reject_reason)`` otherwise.
    Pure: performs no database access, so it is shared by the generator and the
    local preview tool.
    """
    fen = row.get("fen_before")
    if not isinstance(fen, str) or not fen.strip():
        return None, "bad_fen"
    try:
        board = chess.Board(fen)
    except ValueError:
        return None, "bad_fen"

    lines = parse_lines(row.get("top_moves"))
    if len(lines) < 2:
        return None, "too_few_lines"

    best = lines[0]
    try:
        solution_move = chess.Move.from_uci(best.move_uci)
    except ValueError:
        return None, "bad_solution_move"
    if solution_move not in board.legal_moves:
        return None, "illegal_solution_move"

    cp_loss = int(row["centipawn_loss"])
    best_cp = best.score.cp
    played_after_cp = best_cp - cp_loss  # both from mover POV

    is_capture = board.is_capture(solution_move)
    gives_check = board.gives_check(solution_move)
    is_promotion = solution_move.promotion is not None
    solution_is_forcing = is_capture or gives_check or is_promotion
    solution_is_recapture = _is_recapture(row.get("prev_move_uci"), solution_move, is_capture)

    primary_tag, themes = detect_themes(
        board,
        best.move_uci,
        best.pv,
        is_mate=best.score.is_mate,
        best_cp=best_cp,
        played_after_cp=played_after_cp,
    )

    assessment = evaluate_quality(
        lines,
        cp_loss,
        themes=themes,
        solution_is_forcing=solution_is_forcing,
        solution_is_quiet=not solution_is_forcing,
        solution_is_recapture=solution_is_recapture,
        mate_in=best.score.mate_in,
        config=config,
    )
    if not assessment.is_quality:
        return None, assessment.reject_reason or "unknown"

    record = {
        "move_analysis_id": int(row["move_analysis_id"]),
        "game_analysis_id": int(row["game_analysis_id"]),
        "game_id": int(row["game_id"]),
        "source_player_id": int(row["source_player_id"]),
        "fen_before": fen,
        "last_move_uci": row.get("last_move_uci"),
        "solution_uci": best.move_uci,
        "solution_san": board.san(solution_move),
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
        "phase": classify_phase(board),
        "tag": primary_tag,
        "themes": themes,
        "cp_loss": cp_loss,
        "top1_cp": lines[0].score.cp,
        "top2_cp": lines[1].score.cp,
        "solution_line_uci": best.pv,
        "difficulty": assessment.difficulty,
        "quality_score": assessment.quality_score,
        "is_mate": best.score.is_mate,
        "mate_in": best.score.mate_in,
    }
    return record, None


def insert_puzzle_record(conn: Connection, record: dict[str, Any]) -> bool:
    """Insert one puzzle record. Returns True if a row was created."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO puzzles (
                move_analysis_id, game_analysis_id, game_id, source_player_id,
                fen_before, last_move_uci, solution_uci, solution_san, side_to_move,
                phase, tag, cp_loss, top1_cp, top2_cp,
                themes, solution_line_uci, difficulty, quality_score, is_mate, mate_in
            )
            VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (move_analysis_id) DO NOTHING
            """,
            (
                record["move_analysis_id"],
                record["game_analysis_id"],
                record["game_id"],
                record["source_player_id"],
                record["fen_before"],
                record["last_move_uci"],
                record["solution_uci"],
                record["solution_san"],
                record["side_to_move"],
                record["phase"],
                record["tag"],
                record["cp_loss"],
                record["top1_cp"],
                record["top2_cp"],
                Json(record["themes"]),
                Json(record["solution_line_uci"]),
                record["difficulty"],
                record["quality_score"],
                record["is_mate"],
                record["mate_in"],
            ),
        )
        return cur.rowcount > 0


def generate_pending_puzzles(
    conn: Connection,
    *,
    min_centipawn_loss: int = 150,
    min_top_score_gap_cp: int = 120,
    solution_eval_floor_cp: int = -150,
    solution_eval_ceiling_cp: int = 0,
) -> dict[str, Any]:
    config = QualityConfig(
        min_cp_loss=min_centipawn_loss,
        min_top_gap_cp=min_top_score_gap_cp,
        solution_eval_floor_cp=solution_eval_floor_cp,
        solution_eval_ceiling_cp=solution_eval_ceiling_cp,
    )

    inserted = 0
    considered = 0
    rejected: dict[str, int] = {}

    for row in _candidate_rows(conn):
        considered += 1
        record, reason = evaluate_candidate(row, config)
        if record is None:
            rejected[reason or "unknown"] = rejected.get(reason or "unknown", 0) + 1
            continue
        if insert_puzzle_record(conn, record):
            inserted += 1

    return {
        "inserted": inserted,
        "considered": considered,
        "rejected": rejected,
    }
