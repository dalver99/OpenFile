"""Low-level parsing of stored engine ``top_moves`` entries.

Both the remote Stockfish HTTP service and the local UCI client store each
candidate line as a dict containing at least a move (UCI) and a centipawn
score, and usually the principal variation (``pv``) and a human-readable
``score`` string such as ``"+120"`` or ``"#3"``. These helpers normalize those
shapes into a single representation the rest of the puzzle pipeline can rely on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Centipawn magnitude used to represent a forced mate. Kept in sync with the
# local engine client's MATE_SCORE so both backends agree.
MATE_SCORE = 100_000
# Any |score_cp| at or above this is treated as a forced mate rather than a
# normal evaluation.
MATE_THRESHOLD = 90_000


@dataclass(frozen=True)
class Score:
    cp: int
    is_mate: bool
    mate_in: int | None  # signed: positive = mating, negative = getting mated


def _move_uci(entry: dict[str, Any]) -> str | None:
    for key in ("best_move", "move_uci", "move", "uci"):
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    # Fall back to the first PV move.
    pv = entry.get("pv")
    if isinstance(pv, list) and pv and isinstance(pv[0], str) and pv[0].strip():
        return pv[0].strip()
    return None


def _pv(entry: dict[str, Any]) -> list[str]:
    pv = entry.get("pv")
    if not isinstance(pv, list):
        return []
    return [m.strip() for m in pv if isinstance(m, str) and m.strip()]


def _read_score(entry: dict[str, Any]) -> Score | None:
    # Prefer an explicit mate marker in the human-readable score string.
    raw = entry.get("score")
    if isinstance(raw, str) and "#" in raw:
        body = raw.replace("#", "").strip()
        sign = -1 if body.startswith("-") else 1
        digits = "".join(ch for ch in body if ch.isdigit())
        mate_in = int(digits) * sign if digits else None
        cp = sign * (MATE_SCORE - (abs(mate_in) if mate_in else 0))
        return Score(cp=cp, is_mate=True, mate_in=mate_in)

    for key in ("score_cp", "cp", "eval_cp", "evaluation_cp"):
        value = entry.get(key)
        if value is None:
            continue
        try:
            cp = int(value)
        except (TypeError, ValueError):
            return None
        if abs(cp) >= MATE_THRESHOLD:
            distance = MATE_SCORE - abs(cp)
            return Score(cp=cp, is_mate=True, mate_in=distance if cp > 0 else -distance)
        return Score(cp=cp, is_mate=False, mate_in=None)
    return None


@dataclass(frozen=True)
class Line:
    move_uci: str
    score: Score
    pv: list[str]


def parse_lines(top_moves: Any) -> list[Line]:
    """Normalize a stored ``top_moves`` array into ordered :class:`Line` objects.

    Lines missing a move or a score are dropped. Order is preserved (engines
    already return these best-first / by multipv rank).
    """
    if not isinstance(top_moves, list):
        return []
    lines: list[Line] = []
    for entry in top_moves:
        if not isinstance(entry, dict):
            continue
        move = _move_uci(entry)
        score = _read_score(entry)
        if move is None or score is None:
            continue
        lines.append(Line(move_uci=move, score=score, pv=_pv(entry)))
    return lines
