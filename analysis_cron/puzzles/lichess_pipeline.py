"""Glue between the database and the Lichess-style generator.

Loads analyzed games, reconstructs each game with a per-ply evaluation map
(from stored move analyses), runs the engine-backed generator, and turns the
resulting forced-line puzzles into records compatible with the ``puzzles``
table / HTML preview.
"""

from __future__ import annotations

import io
from typing import Any, Iterator

import chess
import chess.pgn
from chess.engine import PovScore
from psycopg import Connection
from psycopg.rows import dict_row

from analysis_cron.puzzles.lichess_generator import (
    GamePuzzle,
    LichessStyleGenerator,
    cp_to_score,
)
from analysis_cron.puzzles.phase import classify_phase
from analysis_cron.puzzles.themes import detect_themes


def _analyzed_games(conn: Connection, limit: int | None) -> list[dict[str, Any]]:
    clause = f"LIMIT {int(limit)}" if limit else ""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT ga.id AS game_analysis_id, ga.game_id, ga.player_id AS source_player_id,
                   g.pgn
            FROM game_analyses ga
            JOIN chesscom_games g ON g.id = ga.game_id
            WHERE g.pgn IS NOT NULL AND g.pgn <> ''
            ORDER BY ga.created_at DESC
            {clause}
            """
        )
        return [dict(r) for r in cur.fetchall()]


def _move_rows(conn: Connection, game_analysis_id: int) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, ply, side, evaluation_after_cp
            FROM move_analyses
            WHERE game_analysis_id = %s
            ORDER BY ply
            """,
            (game_analysis_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def _eval_map(rows: list[dict[str, Any]]) -> dict[int, PovScore]:
    out: dict[int, PovScore] = {}
    for r in rows:
        cp = r.get("evaluation_after_cp")
        if cp is None:
            continue
        white_cp = int(cp) if r["side"] == "white" else -int(cp)
        out[int(r["ply"])] = PovScore(cp_to_score(white_cp), chess.WHITE)
    return out


def _ply_to_move_analysis_id(rows: list[dict[str, Any]]) -> dict[int, int]:
    return {int(r["ply"]): int(r["id"]) for r in rows}


def _difficulty(num_plies: int, is_mate: bool, mate_in: int | None) -> int:
    d = 2
    if num_plies >= 5:
        d += 1
    if num_plies >= 7:
        d += 1
    if is_mate and (mate_in or 0) >= 4:
        d += 1
    return max(1, min(5, d))


def _quality(num_plies: int, is_mate: bool) -> int:
    score = 70 + min(num_plies * 4, 25)
    if is_mate:
        score += 5
    return max(0, min(100, score))


def _record(game: dict[str, Any], gp: GamePuzzle, ply_to_maid: dict[int, int]) -> dict[str, Any] | None:
    cooked = gp.cooked
    board = chess.Board(cooked.start_fen)
    try:
        first_move = chess.Move.from_uci(cooked.solution_uci[0])
    except (ValueError, IndexError):
        return None
    if first_move not in board.legal_moves:
        return None

    maid = ply_to_maid.get(gp.mistake_ply)
    if maid is None:
        return None

    side_to_move = "white" if board.turn == chess.WHITE else "black"
    start_cp = None if cooked.is_mate else (cooked.final_cp)
    num_plies = len(cooked.solution_uci)
    mate_in = (num_plies + 1) // 2 if cooked.is_mate else None

    best_cp_for_theme = 100_000 if cooked.is_mate else (start_cp or 300)
    primary_tag, themes = detect_themes(
        board,
        cooked.solution_uci[0],
        cooked.solution_uci,
        is_mate=cooked.is_mate,
        best_cp=best_cp_for_theme,
        played_after_cp=best_cp_for_theme - (gp.swing_cp or 0),
    )

    return {
        "move_analysis_id": maid,
        "game_analysis_id": int(game["game_analysis_id"]),
        "game_id": int(game["game_id"]),
        "source_player_id": int(game["source_player_id"]),
        "fen_before": cooked.start_fen,
        "last_move_uci": gp.node.move.uci() if gp.node.move else None,
        "solution_uci": cooked.solution_uci[0],
        "solution_san": board.san(first_move),
        "side_to_move": side_to_move,
        "phase": classify_phase(board),
        "tag": primary_tag,
        "themes": themes,
        "cp_loss": abs(gp.swing_cp) if gp.swing_cp is not None else (start_cp or 0),
        "top1_cp": start_cp,
        "top2_cp": None,
        "solution_line_uci": cooked.solution_uci,
        "difficulty": _difficulty(num_plies, cooked.is_mate, mate_in),
        "quality_score": _quality(num_plies, cooked.is_mate),
        "is_mate": cooked.is_mate,
        "mate_in": mate_in,
    }


def generate_records(
    conn: Connection,
    generator: LichessStyleGenerator,
    *,
    limit_games: int | None = None,
    log=lambda _m: None,
) -> Iterator[dict[str, Any]]:
    games = _analyzed_games(conn, limit_games)
    log(f"analyzed games to scan: {len(games)}")
    for game in games:
        rows = _move_rows(conn, int(game["game_analysis_id"]))
        eval_map = _eval_map(rows)
        if not eval_map:
            continue
        try:
            pgn_game = chess.pgn.read_game(io.StringIO(game["pgn"]))
        except Exception:  # noqa: BLE001
            continue
        if pgn_game is None:
            continue
        gp = generator.analyze_game(pgn_game, eval_map)
        if gp is None:
            continue
        rec = _record(game, gp, _ply_to_move_analysis_id(rows))
        if rec is not None:
            log(f"  puzzle @ ply {gp.mistake_ply}: {rec['solution_san']} "
                f"({rec['tag']}, {len(rec['solution_line_uci'])}-ply, q={rec['quality_score']})")
            yield rec
