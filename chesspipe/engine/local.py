"""Local Stockfish backend (UCI via python-chess).

Holds one persistent engine process for the lifetime of the client (cheap
repeated per-position analysis while cooking puzzles). Call ``close()`` when
done, or use it as a context manager.
"""

from __future__ import annotations

import io
from typing import Any

import chess
import chess.engine
import chess.pgn
from chess.engine import Limit, PovScore

from chesspipe import heuristics
from chesspipe.engine.base import Line

# Centipawn magnitude assigned to a forced mate so mate lines sort correctly
# while still behaving like an integer cp score in stored analysis.
MATE_SCORE = 100_000


def _score_cp(pov_score: PovScore) -> int:
    """Centipawns from the perspective of the side to move at the node."""
    return pov_score.relative.score(mate_score=MATE_SCORE)


def _top_moves(infos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(infos, key=lambda info: info.get("multipv", 1))
    out: list[dict[str, Any]] = []
    for info in ordered:
        pv = info.get("pv") or []
        score = info.get("score")
        if not pv or score is None:
            continue
        out.append(
            {
                "move": pv[0].uci(),
                "score_cp": _score_cp(score),
                "pv": [m.uci() for m in pv],
            }
        )
    return out


class LocalEngine:
    def __init__(
        self,
        path: str,
        *,
        threads: int = 1,
        hash_mb: int = 128,
        depth: int = 21,
        time_sec: float = 5.0,
    ) -> None:
        self.path = path
        self._threads = threads
        self._hash_mb = hash_mb
        self._depth = depth
        self._time_sec = time_sec
        self._engine: chess.engine.SimpleEngine | None = None

    def __enter__(self) -> "LocalEngine":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _ensure(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            engine = chess.engine.SimpleEngine.popen_uci(self.path)
            options: dict[str, Any] = {}
            if "Threads" in engine.options:
                options["Threads"] = self._threads
            if "Hash" in engine.options:
                options["Hash"] = self._hash_mb
            if options:
                engine.configure(options)
            self._engine = engine
        return self._engine

    def _position_limit(self) -> Limit:
        return Limit(depth=self._depth, time=self._time_sec)

    def health(self) -> dict[str, Any]:
        engine = self._ensure()
        return {"status": "ok", "mode": "local", "engine": engine.id.get("name", "unknown")}

    def analyse_position(self, board: chess.Board, multipv: int = 1) -> list[Line]:
        engine = self._ensure()
        infos = engine.analyse(board, self._position_limit(), multipv=multipv)
        if isinstance(infos, dict):
            infos = [infos]
        lines: list[Line] = []
        for info in sorted(infos, key=lambda i: i.get("multipv", 1)):
            pv = info.get("pv") or []
            score = info.get("score")
            if score is None:
                continue
            lines.append(Line(pv=list(pv), score=score.pov(board.turn)))
        return lines

    def best_move(self, board: chess.Board) -> chess.Move | None:
        engine = self._ensure()
        result = engine.play(board, self._position_limit())
        return result.move

    def analyse_game(self, pgn: str, depth: int, multipv: int) -> dict[str, Any]:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            raise ValueError("Could not parse PGN.")

        board = game.board()
        moves_out: list[dict[str, Any]] = []
        limit = Limit(depth=depth)
        engine = self._ensure()

        for ply, move in enumerate(game.mainline_moves(), start=1):
            side = "white" if board.turn == chess.WHITE else "black"
            move_number = board.fullmove_number
            fen_before = board.fen()
            san = board.san(move)
            uci = move.uci()

            infos = engine.analyse(board, limit, multipv=multipv)
            if isinstance(infos, dict):
                infos = [infos]
            top = _top_moves(infos)
            eval_before_cp = top[0]["score_cp"] if top else 0

            played_rank: int | None = None
            eval_after_cp: int | None = None
            for rank, entry in enumerate(top, start=1):
                if entry["move"] == uci:
                    played_rank = rank
                    eval_after_cp = entry["score_cp"]
                    break

            board.push(move)
            fen_after = board.fen()

            if eval_after_cp is None:
                child = engine.analyse(board, limit, multipv=1)
                child_info = child[0] if isinstance(child, list) else child
                eval_after_cp = -_score_cp(child_info["score"])

            played_best = played_rank == 1
            centipawn_loss = max(0, eval_before_cp - eval_after_cp)
            classification = heuristics.classify_category(
                centipawn_loss, played_best, eval_before_cp, eval_after_cp
            )

            moves_out.append(
                {
                    "ply": ply,
                    "move_number": move_number,
                    "side": side,
                    "move": uci,
                    "san": san,
                    "classification": classification,
                    "centipawn_loss": centipawn_loss,
                    "evaluation_before_cp": eval_before_cp,
                    "evaluation_after_cp": eval_after_cp,
                    "evaluation_change_cp": eval_after_cp - eval_before_cp,
                    "played_rank": played_rank,
                    "top_moves": top,
                    "fen_before": fen_before,
                    "fen_after": fen_after,
                }
            )

        return {
            "summary": heuristics.summarize(moves_out),
            "moves": moves_out,
            "mode": "local",
            "depth": depth,
            "multipv": multipv,
        }

    def close(self) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None
