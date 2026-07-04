"""Engine backend interface shared by the local and remote implementations.

Both backends expose per-position analysis (needed to cook Lichess-style
puzzles) and whole-game analysis (the analyze stage), so switching between a
local UCI binary and the remote engine_server is purely a config choice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import chess
from chess.engine import Score


@dataclass(frozen=True)
class Line:
    """One analysed line. ``score`` is relative to the side to move."""

    pv: list[chess.Move]
    score: Score

    @property
    def move(self) -> chess.Move | None:
        return self.pv[0] if self.pv else None


class EngineClient(Protocol):
    def health(self) -> dict[str, Any]:
        ...

    def analyse_position(self, board: chess.Board, multipv: int = 1) -> list[Line]:
        """Analyse a single position; lines ordered best-first, side-to-move POV."""
        ...

    def best_move(self, board: chess.Board) -> chess.Move | None:
        ...

    def analyse_game(self, pgn: str, depth: int, multipv: int) -> dict[str, Any]:
        """Whole-game analysis; returns the stored ``{summary, moves, ...}`` shape."""
        ...

    def close(self) -> None:
        ...
