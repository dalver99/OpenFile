from __future__ import annotations

from typing import Any

import cairosvg
import chess
import chess.svg


def _safe_last_move(last_move_uci: str | None) -> chess.Move | None:
    if not last_move_uci:
        return None
    try:
        return chess.Move.from_uci(last_move_uci)
    except ValueError:
        return None


def render_board_png(
    fen: str,
    last_move_uci: str | None,
    perspective: str,
    size: int = 640,
) -> bytes:
    """Puzzles should pass last_move_uci=None so the blunder move is not drawn on the board."""
    board = chess.Board(fen)
    last_move = _safe_last_move(last_move_uci)
    flipped = perspective.lower() == "black"
    svg = chess.svg.board(
        board=board,
        size=size,
        flipped=flipped,
        lastmove=last_move,
        coordinates=True,
    )
    return cairosvg.svg2png(bytestring=svg.encode("utf-8"))


def parse_answer_to_uci(fen: str, raw_answer: str) -> str | None:
    text = raw_answer.strip()
    if not text:
        return None

    board = chess.Board(fen)

    # First attempt: already UCI.
    try:
        move = chess.Move.from_uci(text.lower())
        if move in board.legal_moves:
            return move.uci()
    except ValueError:
        pass

    # Second attempt: SAN entered by user.
    try:
        move = board.parse_san(text)
        return move.uci()
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
    board = chess.Board(fen)
    return "White" if board.turn == chess.WHITE else "Black"


def build_puzzle_caption(puzzle: dict[str, Any]) -> str:
    side = describe_side_to_move(str(puzzle["fen_before"]))
    phase = str(puzzle.get("phase", "middlegame")).capitalize()
    tag = str(puzzle.get("tag", "mixed")).capitalize()
    cp_loss = puzzle.get("cp_loss")
    return (
        f"Find the best move for {side}.\n"
        f"Phase: {phase} | Type: {tag} | Missed value: {cp_loss} cp\n"
        "Reply with a move in SAN (e.g. Nf3) or UCI (e.g. g1f3)."
    )

