"""Move classification heuristics for whole-game analysis.

Turns a centipawn-loss / engine-agreement signal into a human-readable
category. Used by the local engine backend (which produces raw engine scores
that still need classifying); all local analysis applies the same
vocabulary on its side.
"""

from __future__ import annotations

from typing import Any

import chess

from chesspipe.material import sacrifice_value

# OpenFile Brilliant is intentionally conservative and explainable. A move
# must be a sound, engine-best material offer with a meaningfully worse
# runner-up. The thresholds are mover-relative centipawns.
BRILLIANT_MIN_SACRIFICE_CP = 100
BRILLIANT_MAX_LOSS_CP = 15
BRILLIANT_MAX_STARTING_ADVANTAGE_CP = 500
BRILLIANT_MIN_RESULT_CP = -100
BRILLIANT_MIN_ALTERNATIVE_GAP_CP = 75

# Canonical label vocabulary, best-to-worst.
CATEGORY_ORDER = (
    "brilliant",
    "great",
    "best",
    "good",
    "inaccuracy",
    "mistake",
    "blunder",
)


def classify_category(
    centipawn_loss: int,
    played_best: bool,
    eval_before_cp: int,
    eval_after_cp: int,
    *,
    brilliant: bool = False,
) -> str:
    """Classify a single move from the mover's point of view (centipawns)."""
    if brilliant:
        return "brilliant"
    if centipawn_loss <= 10 and played_best:
        return "best"
    if centipawn_loss <= 25:
        return "great" if eval_after_cp > eval_before_cp + 75 else "good"
    if centipawn_loss <= 70:
        return "inaccuracy"
    if centipawn_loss <= 180:
        return "mistake"
    return "blunder"


def brilliant_candidate(board: chess.Board, move: chess.Move) -> int:
    """Return the offered material if a move deserves deeper verification."""
    if board.legal_moves.count() <= 1:
        return 0
    return sacrifice_value(board, move)


def is_brilliant_move(
    *,
    centipawn_loss: int,
    played_best: bool,
    eval_before_cp: int,
    eval_after_cp: int,
    sacrifice_cp: int,
    best_cp: int | None,
    second_best_cp: int | None,
) -> bool:
    """Verify a material sacrifice using the selectively deepened engine lines."""
    if sacrifice_cp < BRILLIANT_MIN_SACRIFICE_CP:
        return False
    if not played_best or centipawn_loss > BRILLIANT_MAX_LOSS_CP:
        return False
    if eval_before_cp > BRILLIANT_MAX_STARTING_ADVANTAGE_CP:
        return False
    if eval_after_cp < BRILLIANT_MIN_RESULT_CP:
        return False
    if best_cp is None or second_best_cp is None:
        return False
    return best_cp - second_best_cp >= BRILLIANT_MIN_ALTERNATIVE_GAP_CP


def empty_summary() -> dict[str, int]:
    return {category: 0 for category in CATEGORY_ORDER}


def summarize(moves: list[dict[str, Any]]) -> dict[str, int]:
    summary = empty_summary()
    for move in moves:
        category = move.get("classification") or "unknown"
        summary[category] = summary.get(category, 0) + 1
    return summary
