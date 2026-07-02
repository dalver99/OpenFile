"""Local Stockfish (UCI) client.

A drop-in alternative to :class:`analysis_cron.stockfish_client.StockfishClient`
that drives a locally installed Stockfish binary through python-chess instead
of calling a remote HTTP service. It exposes the same ``health()`` and
``analyze_game(pgn, depth, multipv)`` interface and returns the same JSON shape
the HTTP service does, so the rest of the pipeline (storage, puzzle generation)
is unaffected by which engine backend is used.
"""

from __future__ import annotations

import io
from typing import Any

import chess
import chess.engine
import chess.pgn

from analysis_cron import heuristics

# Centipawn magnitude assigned to a forced mate so mate lines sort above / below
# any normal evaluation while still behaving like an integer cp score.
MATE_SCORE = 100_000


def _score_cp(pov_score: chess.engine.PovScore) -> int:
    """Centipawns from the perspective of the side to move at the analysed node."""
    return pov_score.relative.score(mate_score=MATE_SCORE)


def _build_top_moves(infos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert python-chess multipv InfoDicts into serializable top-move entries.

    Each entry mirrors the remote API contract consumed by the puzzle
    generator: a ``move`` (UCI), a ``score_cp`` (mover POV), and the ``pv``.
    """
    ordered = sorted(infos, key=lambda info: info.get("multipv", 1))
    top_moves: list[dict[str, Any]] = []
    for info in ordered:
        pv = info.get("pv") or []
        if not pv:
            continue
        score = info.get("score")
        if score is None:
            continue
        top_moves.append(
            {
                "move": pv[0].uci(),
                "score_cp": _score_cp(score),
                "pv": [move.uci() for move in pv],
            }
        )
    return top_moves


class LocalStockfishClient:
    def __init__(
        self,
        engine_path: str,
        *,
        threads: int = 1,
        hash_mb: int = 128,
        analyze_game_timeout_sec: int = 20 * 60,
    ) -> None:
        self.engine_path = engine_path
        self._threads = threads
        self._hash_mb = hash_mb
        # Kept for interface parity with the HTTP client; per-position analysis
        # is bounded by depth rather than a wall-clock timeout.
        self._analyze_game_timeout_sec = analyze_game_timeout_sec

    def _configure(self, engine: chess.engine.SimpleEngine) -> None:
        options: dict[str, Any] = {}
        available = engine.options
        if "Threads" in available:
            options["Threads"] = self._threads
        if "Hash" in available:
            options["Hash"] = self._hash_mb
        if options:
            engine.configure(options)

    def health(self) -> dict[str, Any]:
        with chess.engine.SimpleEngine.popen_uci(self.engine_path) as engine:
            name = engine.id.get("name", "unknown")
        return {"status": "ok", "mode": "local", "engine": name}

    def analyze_game(self, pgn: str, depth: int, multipv: int) -> dict[str, Any]:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            raise ValueError("Could not parse PGN.")

        board = game.board()
        moves_out: list[dict[str, Any]] = []
        limit = chess.engine.Limit(depth=depth)

        with chess.engine.SimpleEngine.popen_uci(self.engine_path) as engine:
            self._configure(engine)
            for ply, move in enumerate(game.mainline_moves(), start=1):
                side = "white" if board.turn == chess.WHITE else "black"
                move_number = board.fullmove_number
                fen_before = board.fen()
                san = board.san(move)
                uci = move.uci()

                infos = engine.analyse(board, limit, multipv=multipv)
                top_moves = _build_top_moves(infos)
                eval_before_cp = top_moves[0]["score_cp"] if top_moves else 0

                # If the played move is among the top lines we already have its
                # evaluation (mover POV); otherwise evaluate the child position.
                played_rank: int | None = None
                eval_after_cp: int | None = None
                for rank, entry in enumerate(top_moves, start=1):
                    if entry["move"] == uci:
                        played_rank = rank
                        eval_after_cp = entry["score_cp"]
                        break

                board.push(move)
                fen_after = board.fen()

                if eval_after_cp is None:
                    child = engine.analyse(board, limit, multipv=1)
                    child_info = child[0] if isinstance(child, list) else child
                    # child score is from the opponent's POV; invert to the mover.
                    eval_after_cp = -_score_cp(child_info["score"])

                played_best = played_rank == 1
                centipawn_loss = max(0, eval_before_cp - eval_after_cp)
                evaluation_change_cp = eval_after_cp - eval_before_cp
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
                        "evaluation_change_cp": evaluation_change_cp,
                        "played_rank": played_rank,
                        "top_moves": top_moves,
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
