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


def _move_metrics(
    before_lines: list[dict[str, Any]],
    after_lines: list[dict[str, Any]],
    played_uci: str,
    before_board: chess.Board,
    after_board: chess.Board,
) -> tuple[int, int, int, int | None]:
    """Return mover-POV before/after scores, loss, and played rank."""
    eval_before_cp = _position_score(before_lines, before_board)
    # The adjacent position is evaluated for the opponent, so invert it to
    # reuse that exact result from the mover's point of view.
    eval_after_cp = -_position_score(after_lines, after_board)
    played_rank = next(
        (
            rank
            for rank, entry in enumerate(before_lines, start=1)
            if entry["move"] == played_uci
        ),
        None,
    )
    return (
        eval_before_cp,
        eval_after_cp,
        max(0, eval_before_cp - eval_after_cp),
        played_rank,
    )


def _position_score(
    lines: list[dict[str, Any]],
    board: chess.Board,
) -> int:
    if lines:
        return int(lines[0]["score_cp"])
    if board.is_checkmate():
        return -MATE_SCORE
    return 0


class LocalEngine:
    def __init__(
        self,
        path: str,
        *,
        threads: int = 1,
        hash_mb: int = 128,
        depth: int = 21,
        time_sec: float = 5.0,
        analysis_deep_depth: int = 20,
        analysis_deep_multipv: int = 3,
        analysis_deep_threshold_cp: int = 60,
        analysis_deep_max_moves: int = 12,
    ) -> None:
        self.path = path
        self._threads = threads
        self._hash_mb = hash_mb
        self._depth = depth
        self._time_sec = time_sec
        self._analysis_deep_depth = analysis_deep_depth
        self._analysis_deep_multipv = analysis_deep_multipv
        self._analysis_deep_threshold_cp = analysis_deep_threshold_cp
        self._analysis_deep_max_moves = analysis_deep_max_moves
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
        engine = self._ensure()
        moves = list(game.mainline_moves())
        positions = [board.copy(stack=False)]
        move_context: list[dict[str, Any]] = []

        for ply, move in enumerate(moves, start=1):
            move_context.append(
                {
                    "ply": ply,
                    "move_number": board.fullmove_number,
                    "side": "white" if board.turn == chess.WHITE else "black",
                    "move": move.uci(),
                    "san": board.san(move),
                    "fen_before": board.fen(),
                }
            )
            board.push(move)
            move_context[-1]["fen_after"] = board.fen()
            positions.append(board.copy(stack=False))

        def analyse_at(index: int, search_depth: int, p: int) -> list[dict[str, Any]]:
            if positions[index].is_game_over():
                return []
            infos = engine.analyse(
                positions[index],
                Limit(depth=search_depth),
                multipv=p,
            )
            if isinstance(infos, dict):
                infos = [infos]
            return _top_moves(infos)

        # One fast search for each main-line position. The result for position
        # N+1 is reused as the after-move score for ply N.
        analyses = [
            analyse_at(index, depth, multipv)
            for index in range(len(positions))
        ]

        candidates: list[tuple[int, int]] = []
        for index, context in enumerate(move_context):
            before_cp, after_cp, loss, _rank = _move_metrics(
                analyses[index],
                analyses[index + 1],
                str(context["move"]),
                positions[index],
                positions[index + 1],
            )
            if loss >= self._analysis_deep_threshold_cp:
                candidates.append((loss, index))

        sacrifice_candidates = {
            index: offered
            for index, move in enumerate(moves)
            if (
                offered := heuristics.brilliant_candidate(positions[index], move)
            ) >= heuristics.BRILLIANT_MIN_SACRIFICE_CP
        }

        deep_enabled = (
            self._analysis_deep_max_moves > 0
            and self._analysis_deep_depth > depth
        )
        if deep_enabled:
            # Reserve a few slots for possible brilliancies, then keep the
            # existing loss-based deepening priority. Sacrifice candidates are
            # normally rare, and all work still respects max_deep_moves.
            sacrifice_order = [
                index
                for index, _offered in sorted(
                    sacrifice_candidates.items(),
                    key=lambda item: (item[1], -item[0]),
                    reverse=True,
                )
            ]
            brilliant_reserve = min(3, self._analysis_deep_max_moves)
            deep_move_indexes = set(sacrifice_order[:brilliant_reserve])
            for _priority, index in sorted(candidates, reverse=True):
                if len(deep_move_indexes) >= self._analysis_deep_max_moves:
                    break
                deep_move_indexes.add(index)
            for index in sacrifice_order[brilliant_reserve:]:
                if len(deep_move_indexes) >= self._analysis_deep_max_moves:
                    break
                deep_move_indexes.add(index)
        else:
            deep_move_indexes = set()

        # Critical moves need multiple candidate lines before the move and one
        # accurate result after it. Adjacent critical moves share the same
        # position search instead of analyzing it twice.
        deep_requirements: dict[int, int] = {}
        for index in deep_move_indexes:
            deep_requirements[index] = max(
                deep_requirements.get(index, 1),
                max(
                    self._analysis_deep_multipv,
                    2 if index in sacrifice_candidates else 1,
                ),
            )
            deep_requirements[index + 1] = max(
                deep_requirements.get(index + 1, 1),
                1,
            )
        for index, p in sorted(deep_requirements.items()):
            analyses[index] = analyse_at(index, self._analysis_deep_depth, p)

        moves_out: list[dict[str, Any]] = []
        for index, context in enumerate(move_context):
            top = analyses[index]
            eval_before_cp, eval_after_cp, centipawn_loss, played_rank = (
                _move_metrics(
                    top,
                    analyses[index + 1],
                    str(context["move"]),
                    positions[index],
                    positions[index + 1],
                )
            )
            played_best = played_rank == 1
            best_cp = int(top[0]["score_cp"]) if top else None
            second_best_cp = int(top[1]["score_cp"]) if len(top) > 1 else None
            sacrifice_cp = sacrifice_candidates.get(index, 0)
            brilliant = heuristics.is_brilliant_move(
                centipawn_loss=centipawn_loss,
                played_best=played_best,
                eval_before_cp=eval_before_cp,
                eval_after_cp=eval_after_cp,
                sacrifice_cp=sacrifice_cp,
                best_cp=best_cp,
                second_best_cp=second_best_cp,
            )
            classification = heuristics.classify_category(
                centipawn_loss,
                played_best,
                eval_before_cp,
                eval_after_cp,
                brilliant=brilliant,
            )

            moves_out.append(
                {
                    **context,
                    "classification": classification,
                    "centipawn_loss": centipawn_loss,
                    "evaluation_before_cp": eval_before_cp,
                    "evaluation_after_cp": eval_after_cp,
                    "evaluation_change_cp": eval_after_cp - eval_before_cp,
                    "played_rank": played_rank,
                    "top_moves": top,
                    "brilliant": {
                        "verified": brilliant,
                        "sacrifice_cp": sacrifice_cp,
                        "alternative_gap_cp": (
                            best_cp - second_best_cp
                            if best_cp is not None and second_best_cp is not None
                            else None
                        ),
                    }
                    if sacrifice_cp
                    else None,
                }
            )

        return {
            "summary": heuristics.summarize(moves_out),
            "moves": moves_out,
            "mode": "local",
            "depth": depth,
            "multipv": multipv,
            "adaptive": {
                "enabled": deep_enabled,
                "deep_depth": self._analysis_deep_depth,
                "deep_multipv": self._analysis_deep_multipv,
                "threshold_cp": self._analysis_deep_threshold_cp,
                "max_moves": self._analysis_deep_max_moves,
                "deepened_plies": sorted(index + 1 for index in deep_move_indexes),
                "brilliant_candidate_plies": sorted(
                    index + 1 for index in sacrifice_candidates
                ),
                "base_positions": len(positions),
                "deep_positions": len(deep_requirements),
            },
        }

    def close(self) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None
