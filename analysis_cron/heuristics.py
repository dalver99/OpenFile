"""Move classification heuristics.

Turns a centipawn-loss / engine-agreement signal into a human-readable
category. This is used by the local engine client (which produces raw engine
scores that still need classifying) and can be reused anywhere a consistent
label vocabulary is needed.
"""

from __future__ import annotations

from typing import Any

# A position that is winning by at least this many centipawns.
WINNING_CP = 300

# Canonical label vocabulary, best-to-worst. Kept stable so stored summaries
# and Telegram captions can rely on the same keys.
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
    """Classify a single move from the mover's point of view.

    All evaluations are centipawns from the perspective of the side that made
    the move (positive = good for the mover).
    """
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


def describe_category(
    category: str,
    centipawn_loss: int,
    played_best: bool,
    eval_before_cp: int,
    eval_after_cp: int,
) -> str:
    """Return a short human-readable note for a classified move."""
    if category == "brilliant":
        return "Engine-top move that turns a clearly worse position into at least equal."
    if category == "best":
        return "Matches Stockfish's first principal-variation move with negligible loss."
    if category == "great":
        return "Improves the evaluation substantially with little or no engine loss."
    if category == "good":
        return "Keeps the evaluation stable within the normal noise range."
    if category == "inaccuracy":
        return f"Loses {centipawn_loss} cp; worth reviewing, but not usually decisive."
    if category == "mistake":
        return f"Loses {centipawn_loss} cp and changes the position meaningfully."
    if category == "blunder":
        return f"Loses {centipawn_loss} cp, likely a tactical or strategic turning point."
    best_text = "engine top move" if played_best else "not engine top move"
    return f"{best_text}; evaluation changed from {eval_before_cp} to {eval_after_cp} cp."


def empty_summary() -> dict[str, int]:
    """A zeroed summary keyed by every canonical category."""
    return {category: 0 for category in CATEGORY_ORDER}


def summarize(moves: list[dict[str, Any]]) -> dict[str, int]:
    """Count classifications across a list of analyzed-move dicts."""
    summary = empty_summary()
    for move in moves:
        category = move.get("classification") or "unknown"
        summary[category] = summary.get(category, 0) + 1
    return summary
