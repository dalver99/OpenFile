"""Move classification heuristics for whole-game analysis.

Turns a centipawn-loss / engine-agreement signal into a human-readable
category. Used by the local engine backend (which produces raw engine scores
that still need classifying); the remote engine_server applies the same
vocabulary on its side.
"""

from __future__ import annotations

from typing import Any

# A position winning by at least this many centipawns.
WINNING_CP = 300

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
) -> str:
    """Classify a single move from the mover's point of view (centipawns)."""
    if played_best and eval_before_cp <= -WINNING_CP and eval_after_cp >= 0:
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


def empty_summary() -> dict[str, int]:
    return {category: 0 for category in CATEGORY_ORDER}


def summarize(moves: list[dict[str, Any]]) -> dict[str, int]:
    summary = empty_summary()
    for move in moves:
        category = move.get("classification") or "unknown"
        summary[category] = summary.get(category, 0) + 1
    return summary
