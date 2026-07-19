import io
import logging
import os
import time
from collections.abc import Iterator
from threading import Lock
from typing import Optional

import chess
import chess.engine
import chess.pgn

from config import STOCKFISH_THREADS
from schemas import (
    AnalyzeRequest,
    BestMoveRequest,
    GameAnalyzeRequest,
    MultiPVAnalyzeRequest,
    StreamAnalyzeRequest,
)

_analyze_game_log = logging.getLogger("uvicorn.error")

# Finer progress than 25/50/75/100; no eval / centipawn noise in logs.
_ANALYZE_GAME_MILESTONE_PCTS = tuple(range(5, 101, 5))


def _log_analyze_game_progress(
    index: int,
    total: int,
    seen: set[int],
    *,
    elapsed_s: float,
) -> None:
    if total == 0:
        return
    if total == 1 and index == 1:
        _analyze_game_log.info(
            "analyze-game progress: 100%% (1/1 plies) elapsed=%.1fs",
            elapsed_s,
        )
        return
    newly = [
        m
        for m in _ANALYZE_GAME_MILESTONE_PCTS
        if m not in seen and index * 100 >= m * total
    ]
    if not newly:
        return
    for m in newly:
        seen.add(m)
    top = max(newly)
    _analyze_game_log.info(
        "analyze-game progress: %s%% (%s/%s plies) elapsed=%.1fs",
        top,
        index,
        total,
        elapsed_s,
    )


class EngineManager:
    def __init__(self, path: str) -> None:
        self.path = path
        self._engine: Optional[chess.engine.SimpleEngine] = None
        self._lock = Lock()

    def start(self) -> None:
        if not os.path.exists(self.path):
            raise FileNotFoundError(f"Stockfish binary not found at: {self.path}")
        self._engine = chess.engine.SimpleEngine.popen_uci(self.path)
        self._engine.configure({"Threads": STOCKFISH_THREADS})

    def stop(self) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None

    def _require_engine(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            raise RuntimeError("Engine is not initialized.")
        return self._engine

    def _board_from_request(self, fen: Optional[str], moves: list[str]) -> chess.Board:
        board = chess.Board(fen) if fen else chess.Board()
        for move in moves:
            board.push_uci(move)
        return board

    def _moves_from_game_request(self, payload: GameAnalyzeRequest) -> tuple[chess.Board, list[chess.Move]]:
        if payload.pgn:
            game = chess.pgn.read_game(io.StringIO(payload.pgn))
            if game is None:
                raise ValueError("Could not parse PGN.")
            return game.board(), list(game.mainline_moves())

        if not payload.moves:
            raise ValueError("Provide either pgn or moves.")
        board = chess.Board(payload.start_fen) if payload.start_fen else chess.Board()
        return board, [chess.Move.from_uci(move) for move in payload.moves]

    def _score_to_cp(self, score: chess.engine.PovScore, pov: chess.Color) -> Optional[int]:
        relative_score = score.pov(pov)
        if relative_score.is_mate():
            mate = relative_score.mate()
            if mate is None:
                return None
            return 100_000 if mate > 0 else -100_000
        return relative_score.score()

    def _format_line(self, board: chess.Board, info: dict, rank: int, pov: Optional[chess.Color] = None) -> dict:
        score = info["score"]
        score_pov = board.turn if pov is None else pov
        pv = [move.uci() for move in info.get("pv", [])]
        return {
            "rank": rank,
            "score": str(score.pov(score_pov)),
            "score_cp": self._score_to_cp(score, score_pov),
            # Mate distance (plies-to-mate) from score_pov, or None for a cp score.
            # Lets remote clients rebuild an exact python-chess Mate() score.
            "mate": score.pov(score_pov).mate(),
            "best_move": pv[0] if pv else None,
            "depth": info.get("depth"),
            "nodes": info.get("nodes"),
            "pv": pv,
        }

    def _classify_move(
        self,
        centipawn_loss: Optional[int],
        played_is_top_move: bool,
        played_is_in_top_p: bool,
        before_cp: Optional[int],
        after_cp: Optional[int],
    ) -> str:
        if centipawn_loss is None:
            return "unknown"
        evaluation_change = None if before_cp is None or after_cp is None else after_cp - before_cp
        if before_cp is not None and after_cp is not None and before_cp <= -300 and after_cp >= 0 and centipawn_loss <= 25:
            return "brilliant"
        if played_is_top_move and centipawn_loss <= 10:
            return "best"
        if played_is_in_top_p and centipawn_loss <= 25:
            return "excellent"
        if centipawn_loss <= 25 and evaluation_change is not None and evaluation_change > 75:
            return "great"
        if centipawn_loss <= 25:
            return "good"
        if centipawn_loss <= 70:
            return "inaccuracy"
        if centipawn_loss <= 180:
            return "mistake"
        return "blunder"

    def best_move(self, payload: BestMoveRequest) -> str:
        engine = self._require_engine()
        board = self._board_from_request(payload.fen, payload.moves)
        with self._lock:
            result = engine.play(board, chess.engine.Limit(time=payload.movetime_ms / 1000))
        if result.move is None:
            raise RuntimeError("No legal move found for the given position.")
        return result.move.uci()

    def analyze(self, payload: AnalyzeRequest) -> dict:
        engine = self._require_engine()
        board = self._board_from_request(payload.fen, payload.moves)
        with self._lock:
            info = engine.analyse(board, chess.engine.Limit(depth=payload.depth))

        score = info["score"].pov(board.turn)
        pv = [move.uci() for move in info.get("pv", [])]
        return {
            "score": str(score),
            "score_cp": self._score_to_cp(info["score"], board.turn),
            "mate": score.mate(),
            "depth": info.get("depth"),
            "nodes": info.get("nodes"),
            "pv": pv,
        }

    def analyze_multipv(self, payload: MultiPVAnalyzeRequest) -> dict:
        engine = self._require_engine()
        board = self._board_from_request(payload.fen, payload.moves)
        with self._lock:
            infos = engine.analyse(
                board,
                chess.engine.Limit(depth=payload.depth),
                multipv=payload.p,
            )
        return {
            "depth": payload.depth,
            "p": payload.p,
            "lines": [
                self._format_line(board, info, rank)
                for rank, info in enumerate(infos, start=1)
            ],
        }

    def stream_analyze(self, payload: StreamAnalyzeRequest) -> Iterator[dict]:
        engine = self._require_engine()
        board = self._board_from_request(payload.fen, payload.moves)

        with self._lock:
            with engine.analysis(
                board,
                chess.engine.Limit(depth=payload.max_depth),
                multipv=payload.p,
            ) as analysis:
                latest_by_rank = {}
                last_signature = None

                for info in analysis:
                    if "score" not in info:
                        continue
                    rank = int(info.get("multipv", 1))
                    latest_by_rank[rank] = dict(info)

                    lines = [
                        self._format_line(board, latest_by_rank[item_rank], item_rank)
                        for item_rank in sorted(latest_by_rank)
                        if "score" in latest_by_rank[item_rank]
                    ]
                    if not lines:
                        continue

                    depth = max(line.get("depth") or 0 for line in lines)
                    signature = (
                        depth,
                        tuple((line["rank"], line["score"], line["best_move"], line.get("depth")) for line in lines),
                    )
                    if signature == last_signature:
                        continue
                    last_signature = signature

                    yield {
                        "type": "depth_update",
                        "depth": depth,
                        "p": payload.p,
                        "lines": lines,
                    }

        yield {"type": "complete"}

    def analyze_game(self, payload: GameAnalyzeRequest) -> dict:
        engine = self._require_engine()
        board, moves = self._moves_from_game_request(payload)
        total_plies = len(moves)
        milestone_seen: set[int] = set()
        t0 = time.perf_counter()
        positions = [board.copy(stack=False)]
        move_context = []

        for index, move in enumerate(moves, start=1):
            if move not in board.legal_moves:
                raise ValueError(f"Illegal move at ply {index}: {move.uci()}")
            move_context.append(
                {
                    "ply": index,
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

        with self._lock:
            def analyze_at(position_index: int, depth: int, p: int) -> list[dict]:
                if positions[position_index].is_game_over():
                    return []
                infos = engine.analyse(
                    positions[position_index],
                    chess.engine.Limit(depth=depth),
                    multipv=p,
                )
                if isinstance(infos, dict):
                    infos = [infos]
                return [
                    self._format_line(
                        positions[position_index],
                        info,
                        rank,
                        pov=positions[position_index].turn,
                    )
                    for rank, info in enumerate(infos, start=1)
                ]

            def score_at(position_index: int) -> int:
                if analyses[position_index]:
                    return int(analyses[position_index][0]["score_cp"] or 0)
                if positions[position_index].is_checkmate():
                    return -100_000
                return 0

            analyses = []
            for position_index in range(len(positions)):
                analyses.append(
                    analyze_at(position_index, payload.depth, payload.p)
                )
                if position_index < total_plies:
                    _log_analyze_game_progress(
                        position_index + 1,
                        total_plies,
                        milestone_seen,
                        elapsed_s=time.perf_counter() - t0,
                    )

            candidates: list[tuple[int, int]] = []
            for index, context in enumerate(move_context):
                before_cp = score_at(index)
                after_cp = -score_at(index + 1)
                loss = max(0, before_cp - after_cp)
                if loss >= payload.deep_threshold_cp:
                    candidates.append((loss, index))

            deep_enabled = (
                payload.deep_max_moves > 0
                and payload.deep_depth > payload.depth
            )
            if deep_enabled:
                deep_move_indexes = {
                    index
                    for _priority, index in sorted(candidates, reverse=True)[
                        : payload.deep_max_moves
                    ]
                }
            else:
                deep_move_indexes = set()
            deep_requirements: dict[int, int] = {}
            for index in deep_move_indexes:
                deep_requirements[index] = max(
                    deep_requirements.get(index, 1),
                    payload.deep_p,
                )
                deep_requirements[index + 1] = max(
                    deep_requirements.get(index + 1, 1),
                    1,
                )
            for position_index, p in sorted(deep_requirements.items()):
                analyses[position_index] = analyze_at(
                    position_index,
                    payload.deep_depth,
                    p,
                )

        move_analyses = []
        for index, context in enumerate(move_context):
            candidate_lines = analyses[index]
            best_before_cp = score_at(index)
            after_cp = -score_at(index + 1)
            centipawn_loss = max(0, best_before_cp - after_cp)
            best_moves = [line["best_move"] for line in candidate_lines]
            played_uci = str(context["move"])
            played_rank = (
                best_moves.index(played_uci) + 1
                if played_uci in best_moves
                else None
            )
            classification = self._classify_move(
                centipawn_loss=centipawn_loss,
                played_is_top_move=played_rank == 1,
                played_is_in_top_p=played_rank is not None,
                before_cp=best_before_cp,
                after_cp=after_cp,
            )
            move_analyses.append(
                {
                    **context,
                    "classification": classification,
                    "centipawn_loss": centipawn_loss,
                    "evaluation_before_cp": best_before_cp,
                    "evaluation_after_cp": after_cp,
                    "evaluation_change_cp": after_cp - best_before_cp,
                    "played_rank": played_rank,
                    "top_moves": candidate_lines,
                }
            )

        summary = {
            "total_moves": len(move_analyses),
            "white": {},
            "black": {},
        }
        for item in move_analyses:
            side_summary = summary[item["side"]]
            side_summary[item["classification"]] = side_summary.get(item["classification"], 0) + 1

        return {
            "depth": payload.depth,
            "p": payload.p,
            "summary": summary,
            "moves": move_analyses,
            "adaptive": {
                "enabled": deep_enabled,
                "deep_depth": payload.deep_depth,
                "deep_p": payload.deep_p,
                "threshold_cp": payload.deep_threshold_cp,
                "max_moves": payload.deep_max_moves,
                "deepened_plies": sorted(index + 1 for index in deep_move_indexes),
                "base_positions": len(positions),
                "deep_positions": len(deep_requirements),
            },
        }
