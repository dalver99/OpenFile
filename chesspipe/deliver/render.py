from __future__ import annotations

from datetime import date, datetime
from typing import Any

import cairosvg
import chess
import chess.svg

_STAR = "\u2605"
_EMPTY_STAR = "\u2606"


def _safe_move(uci: str | None) -> chess.Move | None:
    if not uci:
        return None
    try:
        return chess.Move.from_uci(uci)
    except ValueError:
        return None


def render_board_png(
    fen: str,
    last_move_uci: str | None,
    perspective: str,
    size: int = 640,
) -> bytes:
    """Puzzles pass last_move_uci=None so the blunder move is not drawn."""
    board = chess.Board(fen)
    svg = chess.svg.board(
        board=board,
        size=size,
        flipped=perspective.lower() == "black",
        lastmove=_safe_move(last_move_uci),
        coordinates=True,
    )
    return cairosvg.svg2png(bytestring=svg.encode("utf-8"))


def parse_answer_to_uci(fen: str, raw_answer: str) -> str | None:
    text = raw_answer.strip()
    if not text:
        return None
    board = chess.Board(fen)

    try:
        move = chess.Move.from_uci(text.lower())
        if move in board.legal_moves:
            return move.uci()
    except ValueError:
        pass

    try:
        return board.parse_san(text).uci()
    except ValueError:
        return None


def build_solution_san(fen: str, solution_uci: str) -> str | None:
    board = chess.Board(fen)
    try:
        move = chess.Move.from_uci(solution_uci)
    except ValueError:
        return None
    if move not in board.legal_moves:
        return None
    return board.san(move)


def describe_side_to_move(fen: str) -> str:
    return "White" if chess.Board(fen).turn == chess.WHITE else "Black"


def _format_played_at(value: Any) -> str | None:
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    return None


def _game_context_line(puzzle: dict[str, Any]) -> str:
    opponent = puzzle.get("opponent_username")
    time_class = puzzle.get("time_class")
    played_at = _format_played_at(puzzle.get("played_at"))

    bits = []
    if opponent:
        bits.append(f"vs {opponent}")
    if time_class:
        bits.append(str(time_class).capitalize())
    if played_at:
        bits.append(played_at)
    return f"{' | '.join(bits)}\n" if bits else ""


def build_puzzle_caption(puzzle: dict[str, Any]) -> str:
    side = describe_side_to_move(str(puzzle["fen_before"]))
    phase = str(puzzle.get("phase", "middlegame")).capitalize()
    tag = str(puzzle.get("tag", "mixed")).replace("_", " ").capitalize()
    cp_loss = puzzle.get("cp_loss")

    difficulty = puzzle.get("difficulty")
    difficulty_line = ""
    if isinstance(difficulty, int) and difficulty > 0:
        stars = _STAR * difficulty + _EMPTY_STAR * max(0, 5 - difficulty)
        difficulty_line = f"Difficulty: {stars}\n"

    goal = "Find the forced mate" if puzzle.get("is_mate") else f"Find the best move for {side}"

    return (
        f"{goal}.\n"
        f"{_game_context_line(puzzle)}"
        f"Phase: {phase} | Theme: {tag} | Swing: {cp_loss} cp\n"
        f"{difficulty_line}"
        "Reply with a move in SAN (e.g. Nf3) or UCI (e.g. g1f3)."
    )
