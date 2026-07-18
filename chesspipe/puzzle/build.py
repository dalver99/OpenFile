"""Glue between the database and the Lichess-style generator.

Reconstructs a game with its per-ply evaluation map (from stored move analyses),
runs the engine-backed generator, and turns the resulting forced-line puzzle
into a record for the ``puzzles`` table / HTML preview.
"""

from __future__ import annotations

import io
from typing import Any, Iterator, Optional

import chess
import chess.pgn
from chess.engine import PovScore
from psycopg import Connection
from psycopg.rows import dict_row

from chesspipe.puzzle.lichess import GamePuzzle, LichessStyleGenerator, cp_to_score
from chesspipe.puzzle.phase import classify_phase
from chesspipe.puzzle.themes import detect_themes


def analyzed_game_analyses(conn: Connection, limit: int | None = None) -> list[dict[str, Any]]:
    """Game analyses available for puzzle generation (most recent first)."""
    clause = f"LIMIT {int(limit)}" if limit else ""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT ga.id AS game_analysis_id, ga.game_id,
                   ga.player_id AS source_player_id, g.pgn,
                   g.time_class, g.end_time AS played_at,
                   CASE WHEN pg.side = 'white' THEN g.black_username ELSE g.white_username END
                       AS opponent_username
            FROM game_analyses ga
            JOIN chesscom_games g ON g.id = ga.game_id
            JOIN player_games pg ON pg.game_id = ga.game_id AND pg.player_id = ga.player_id
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
            SELECT ply, side, evaluation_after_cp
            FROM move_analyses
            WHERE game_analysis_id = %s
            ORDER BY ply
            """,
            (game_analysis_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def _eval_map(rows: list[dict[str, Any]]) -> dict[int, PovScore]:
    out: dict[int, PovScore] = {}
    for row in rows:
        cp = row.get("evaluation_after_cp")
        if cp is None:
            continue
        white_cp = int(cp) if row["side"] == "white" else -int(cp)
        out[int(row["ply"])] = PovScore(cp_to_score(white_cp), chess.WHITE)
    return out


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


def _record(game: dict[str, Any], gp: GamePuzzle) -> Optional[dict[str, Any]]:
    cooked = gp.cooked
    board = chess.Board(cooked.start_fen)
    try:
        first_move = chess.Move.from_uci(cooked.solution_uci[0])
    except (ValueError, IndexError):
        return None
    if first_move not in board.legal_moves:
        return None

    side_to_move = "white" if board.turn == chess.WHITE else "black"
    start_cp = None if cooked.is_mate else cooked.final_cp
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
        "game_analysis_id": int(game["game_analysis_id"]),
        "game_id": int(game["game_id"]),
        "source_player_id": int(game["source_player_id"]),
        "mistake_ply": gp.mistake_ply,
        "fen_before": cooked.start_fen,
        "last_move_uci": gp.node.move.uci() if gp.node.move else None,
        "solution_uci": cooked.solution_uci[0],
        "solution_san": board.san(first_move),
        "solution_line_uci": cooked.solution_uci,
        "side_to_move": side_to_move,
        "phase": classify_phase(board),
        "tag": primary_tag,
        "themes": themes,
        "cp_loss": abs(gp.swing_cp) if gp.swing_cp is not None else (start_cp or 0),
        "is_mate": cooked.is_mate,
        "mate_in": mate_in,
        "difficulty": _difficulty(num_plies, cooked.is_mate, mate_in),
        "quality_score": _quality(num_plies, cooked.is_mate),
        "time_class": game.get("time_class"),
        "opponent_username": game.get("opponent_username"),
        "played_at": game.get("played_at"),
    }


def cook_record(
    generator: LichessStyleGenerator,
    game: dict[str, Any],
    move_rows: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Cook a puzzle record from in-memory inputs (no DB access).

    Split out so the generate stage can read its inputs, release the DB
    connection, and cook with the engine without holding a transaction open.
    """
    eval_map = _eval_map(move_rows)
    if not eval_map:
        return None
    try:
        pgn_game = chess.pgn.read_game(io.StringIO(game["pgn"]))
    except Exception:  # noqa: BLE001
        return None
    if pgn_game is None:
        return None
    gp = generator.analyze_game(pgn_game, eval_map)
    if gp is None:
        return None
    return _record(game, gp)


def load_move_rows(conn: Connection, game_analysis_id: int) -> list[dict[str, Any]]:
    return _move_rows(conn, game_analysis_id)


def build_for_game_analysis(
    conn: Connection,
    generator: LichessStyleGenerator,
    game: dict[str, Any],
) -> Optional[dict[str, Any]]:
    """Cook a single game analysis into at most one puzzle record."""
    return cook_record(generator, game, _move_rows(conn, int(game["game_analysis_id"])))


def generate_records(
    conn: Connection,
    generator: LichessStyleGenerator,
    *,
    limit_games: int | None = None,
    log=lambda _m: None,
) -> Iterator[dict[str, Any]]:
    """Scan analyzed games and yield puzzle records (used by the preview tool)."""
    games = analyzed_game_analyses(conn, limit_games)
    log(f"analyzed games to scan: {len(games)}")
    for game in games:
        rec = build_for_game_analysis(conn, generator, game)
        if rec is not None:
            log(
                f"  puzzle @ ply {rec['mistake_ply']}: {rec['solution_san']} "
                f"({rec['tag']}, {len(rec['solution_line_uci'])}-ply, q={rec['quality_score']})"
            )
            yield rec
