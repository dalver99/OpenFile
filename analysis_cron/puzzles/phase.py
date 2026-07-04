"""Game-phase classification: opening / middlegame / endgame.

Uses a tapered "game phase" material count (the same weighting engines use for
tapered evaluation) combined with queen presence, development, and move number.
This is far more reliable than a raw move-number cutoff because it adapts to
early queen trades, quick simplifications, and long theoretical openings.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

# Tapered phase weights. Full starting material sums to 24.
_PHASE_WEIGHTS = {
    chess.KNIGHT: 1,
    chess.BISHOP: 1,
    chess.ROOK: 2,
    chess.QUEEN: 4,
}
_MAX_PHASE = 24

OPENING = "opening"
MIDDLEGAME = "middlegame"
ENDGAME = "endgame"


@dataclass(frozen=True)
class PhaseThresholds:
    # At or below this tapered phase value the position is an endgame.
    endgame_phase_max: int = 6
    # Positions with a queen on each side but little else are still endgames.
    endgame_phase_max_with_queens: int = 4
    # Opening only applies while material is nearly intact ...
    opening_phase_min: int = 21
    # ... and within this many full moves.
    opening_move_max: int = 12
    # ... and while few minor pieces have developed off the back rank.
    opening_developed_max: int = 4


def _phase_value(board: chess.Board) -> int:
    total = 0
    for piece in board.piece_map().values():
        total += _PHASE_WEIGHTS.get(piece.piece_type, 0)
    return total


def _developed_minor_count(board: chess.Board) -> int:
    """Minor pieces (N/B) no longer on their original back-rank squares."""
    home = {
        (chess.WHITE, chess.KNIGHT): {chess.B1, chess.G1},
        (chess.WHITE, chess.BISHOP): {chess.C1, chess.F1},
        (chess.BLACK, chess.KNIGHT): {chess.B8, chess.G8},
        (chess.BLACK, chess.BISHOP): {chess.C8, chess.F8},
    }
    developed = 0
    for square, piece in board.piece_map().items():
        if piece.piece_type not in (chess.KNIGHT, chess.BISHOP):
            continue
        home_squares = home.get((piece.color, piece.piece_type), set())
        if square not in home_squares:
            developed += 1
    return developed


def _queens_on_board(board: chess.Board) -> int:
    return len(board.pieces(chess.QUEEN, chess.WHITE)) + len(
        board.pieces(chess.QUEEN, chess.BLACK)
    )


def classify_phase(
    board: chess.Board,
    thresholds: PhaseThresholds | None = None,
) -> str:
    t = thresholds or PhaseThresholds()
    phase = _phase_value(board)
    queens = _queens_on_board(board)

    # Endgame: little material left, or queenless with only a couple of pieces.
    if phase <= t.endgame_phase_max:
        return ENDGAME
    if queens == 0 and phase <= t.endgame_phase_max + t.endgame_phase_max_with_queens:
        return ENDGAME

    # Opening: material nearly intact, early, and not yet fully developed.
    if (
        phase >= t.opening_phase_min
        and board.fullmove_number <= t.opening_move_max
        and _developed_minor_count(board) <= t.opening_developed_max
    ):
        return OPENING

    return MIDDLEGAME
