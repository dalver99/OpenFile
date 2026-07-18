"""Remote Stockfish backend: HTTP client for engine_server.

Uses the per-position endpoints (``/analyze-multipv``) to cook puzzles and
``/analyze-game`` for whole-game analysis. Mate distance is read from the
server's ``mate`` field so reconstructed scores are exact.
"""

from __future__ import annotations

from typing import Any

import chess
import requests
from chess.engine import Cp, Mate, Score

from chesspipe.engine.base import Line


def _score_from(score_cp: int | None, mate: int | None) -> Score:
    if mate is not None:
        return Mate(mate)
    return Cp(int(score_cp)) if score_cp is not None else Cp(0)


class RemoteEngine:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        depth: int = 21,
        time_sec: float = 5.0,
        timeout_sec: int = 1200,
        analysis_deep_depth: int = 20,
        analysis_deep_multipv: int = 3,
        analysis_deep_threshold_cp: int = 60,
        analysis_deep_max_moves: int = 12,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._depth = depth
        # Server search is depth-bound; time_sec kept for interface parity.
        self._time_sec = time_sec
        self._timeout = timeout_sec
        self._analysis_deep_depth = analysis_deep_depth
        self._analysis_deep_multipv = analysis_deep_multipv
        self._analysis_deep_threshold_cp = analysis_deep_threshold_cp
        self._analysis_deep_max_moves = analysis_deep_max_moves
        self.session = requests.Session()
        self.session.headers.update(
            {"Content-Type": "application/json", "X-Stockfish-Api-Key": api_key}
        )

    def __enter__(self) -> "RemoteEngine":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def health(self) -> dict[str, Any]:
        response = self.session.get(f"{self.base_url}/health", timeout=10)
        response.raise_for_status()
        return response.json()

    def analyse_position(self, board: chess.Board, multipv: int = 1) -> list[Line]:
        response = self.session.post(
            f"{self.base_url}/analyze-multipv",
            json={"fen": board.fen(), "depth": self._depth, "p": multipv},
            timeout=self._timeout,
        )
        response.raise_for_status()
        data = response.json()
        lines: list[Line] = []
        for entry in data.get("lines", []):
            pv = [chess.Move.from_uci(u) for u in entry.get("pv", [])]
            lines.append(Line(pv=pv, score=_score_from(entry.get("score_cp"), entry.get("mate"))))
        return lines

    def best_move(self, board: chess.Board) -> chess.Move | None:
        lines = self.analyse_position(board, multipv=1)
        return lines[0].move if lines else None

    def analyse_game(self, pgn: str, depth: int, multipv: int) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/analyze-game",
            json={
                "pgn": pgn,
                "depth": depth,
                "p": multipv,
                "deep_depth": self._analysis_deep_depth,
                "deep_p": self._analysis_deep_multipv,
                "deep_threshold_cp": self._analysis_deep_threshold_cp,
                "deep_max_moves": self._analysis_deep_max_moves,
            },
            timeout=self._timeout,
        )
        response.raise_for_status()
        data = response.json()
        # Normalize each move's top_moves to the stored shape {move, score_cp, pv}.
        for move in data.get("moves", []):
            move["top_moves"] = [
                {
                    "move": entry.get("best_move"),
                    "score_cp": entry.get("score_cp"),
                    "pv": entry.get("pv", []),
                }
                for entry in (move.get("top_moves") or [])
            ]
        return data

    def close(self) -> None:
        self.session.close()
