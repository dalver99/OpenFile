"""Lichess-style puzzle generation.

A reimplementation of the puzzle-generation algorithm used by lichess
(https://github.com/ornicar/lichess-puzzler, AGPL-3.0), written from the
published algorithm rather than copied.

The core idea (unlike a single "best move you missed"):

* Walk the game. At the position *after* each move, the side to move is the
  potential ``winner`` who may have just been handed a tactic.
* Start a puzzle only where the winner was NOT already winning and NOT already
  up material, but the position has just swung to clearly winning (or a mate
  is looming).
* "Cook" a solution: a sequence where every winner move is the *only* good move
  (its winning chance clearly exceeds the second-best), and every defender move
  is the engine's best defense. Continue until the win is realized (advantage)
  or mate is delivered.

Engine access goes through :class:`chesspipe.engine.EngineClient`, so cooking
runs identically on a local UCI binary or the remote engine_server.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import chess
import chess.pgn
from chess import Color, Move
from chess.engine import Cp, Mate, PovScore, Score

from chesspipe.engine.base import EngineClient

# A mate this close (or closer) is treated as a mate puzzle.
MATE_SOON = Mate(15)

# How decisively the best move must beat the second best (in win-chance units,
# range -1..1) for the position to have a single defensible solution.
ONLY_MOVE_WIN_CHANCE_GAP = 0.7


@dataclass
class MovePair:
    board: chess.Board
    winner: Color
    best_move: Move
    best_score: Score
    second_move: Optional[Move]
    second_score: Optional[Score]


@dataclass
class CookedPuzzle:
    start_fen: str
    winner: Color
    solution_uci: list[str]
    final_cp: Optional[int]
    is_mate: bool


def win_chances(score: Score) -> float:
    """Winning chances in [-1, 1] from the given side's perspective.

    Logistic transform of centipawns; mate maps to +/-1. Multiplier matches
    lichess (lichess-org/lila PR 11148).
    """
    mate = score.mate()
    if mate is not None:
        return 1.0 if mate > 0 else -1.0
    cp = score.score()
    if cp is None:
        return 0.0
    return 2 / (1 + math.exp(-0.00368208 * cp)) - 1


def _material_count(board: chess.Board, side: Color) -> int:
    values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    return sum(len(board.pieces(pt, side)) * v for pt, v in values.items())


def material_diff(board: chess.Board, side: Color) -> int:
    return _material_count(board, side) - _material_count(board, not side)


def is_up_in_material(board: chess.Board, side: Color) -> bool:
    return material_diff(board, side) > 0


@dataclass(frozen=True)
class GeneratorConfig:
    # Skip very short puzzles (a single solver move / a lone mate-in-one).
    min_solution_plies: int = 3
    allow_mate_in_one: bool = False


class LichessStyleGenerator:
    def __init__(self, engine: EngineClient, config: GeneratorConfig | None = None):
        self.engine = engine
        self.config = config or GeneratorConfig()

    # --- engine helpers -----------------------------------------------------
    def _move_pair(self, board: chess.Board, winner: Color) -> MovePair:
        # winner is the side to move here, so line scores are already its POV.
        lines = self.engine.analyse_position(board, multipv=2)
        best = lines[0]
        second = lines[1] if len(lines) > 1 else None
        return MovePair(
            board=board,
            winner=winner,
            best_move=best.move,
            best_score=best.score,
            second_move=(second.move if second else None),
            second_score=(second.score if second else None),
        )

    def _best_defense(self, board: chess.Board) -> Optional[Move]:
        return self.engine.best_move(board)

    # --- "only move" test ---------------------------------------------------
    def _is_only_move(self, pair: MovePair) -> bool:
        if pair.second_move is None or pair.second_score is None:
            return True
        if pair.best_score == Mate(1):
            return win_chances(pair.second_score) <= 0.6 or pair.second_score == Mate(1)
        return win_chances(pair.best_score) > win_chances(pair.second_score) + ONLY_MOVE_WIN_CHANCE_GAP

    # --- solution cooking ---------------------------------------------------
    def _cook_mate(self, board: chess.Board, winner: Color) -> Optional[list[Move]]:
        if board.is_game_over():
            return []
        if board.turn == winner:
            pair = self._move_pair(board, winner)
            if pair.best_score < MATE_SOON:
                return None
            move = pair.best_move
        else:
            move = self._best_defense(board)
            if move is None:
                return None
        child = board.copy(stack=False)
        child.push(move)
        follow_up = self._cook_mate(child, winner)
        if follow_up is None:
            return None
        return [move] + follow_up

    def _cook_advantage(self, board: chess.Board, winner: Color) -> Optional[list[MovePair]]:
        if board.is_repetition(2):
            return None
        if board.turn == winner:
            pair = self._move_pair(board, winner)
            if not self._is_only_move(pair):
                return []
            if pair.best_score < Cp(200):
                return None
            move = pair.best_move
            child = board.copy(stack=False)
            child.push(move)
            follow_up = self._cook_advantage(child, winner)
            if follow_up is None:
                return None
            return [pair] + follow_up
        else:
            move = self._best_defense(board)
            if move is None:
                return []
            child = board.copy(stack=False)
            child.push(move)
            defender_pair = MovePair(board, winner, move, Cp(0), None, None)
            follow_up = self._cook_advantage(child, winner)
            if follow_up is None:
                return None
            return [defender_pair] + follow_up

    # --- position gate ------------------------------------------------------
    def _cook_from(
        self, board: chess.Board, winner: Color, prev_score: Score, score: Score
    ) -> Optional[CookedPuzzle]:
        if board.legal_moves.count() < 2:
            return None
        if prev_score > Cp(300) and score < MATE_SOON:
            return None
        if is_up_in_material(board, winner):
            return None

        if score >= Mate(1) and not self.config.allow_mate_in_one:
            if score == Mate(1):
                return None

        if score > MATE_SOON:
            line = self._cook_mate(board.copy(stack=False), winner)
            if not line or len(line) < self.config.min_solution_plies:
                return None
            return CookedPuzzle(board.fen(), winner, [m.uci() for m in line], None, True)

        if score >= Cp(200) and win_chances(score) > win_chances(prev_score) + 0.6:
            if score < Cp(400) and material_diff(board, winner) > -1:
                return None
            pairs = self._cook_advantage(board.copy(stack=False), winner)
            if not pairs:
                return None
            while pairs and (len(pairs) % 2 == 0 or pairs[-1].second_move is None):
                pairs = pairs[:-1]
            if len(pairs) < self.config.min_solution_plies:
                return None
            final_cp = pairs[-1].best_score.score()
            return CookedPuzzle(
                board.fen(), winner, [p.best_move.uci() for p in pairs], final_cp, False
            )
        return None

    # --- game walk ----------------------------------------------------------
    def analyze_game(
        self,
        game: chess.pgn.Game,
        eval_map: dict[int, PovScore],
    ) -> Optional["GamePuzzle"]:
        """Walk a game and return the first quality puzzle found, or None.

        ``eval_map`` maps ply number (of the node *after* a move) to a white-POV
        :class:`PovScore`. Only plies present in the map are considered as
        puzzle starts; the engine cooks (and validates) the solution.
        """
        prev_score: Score = Cp(20)
        board = game.board()
        for node in game.mainline():
            if node.move is None:
                continue
            ply = node.ply()
            board.push(node.move)

            white_eval = eval_map.get(ply)
            if white_eval is None:
                continue

            winner = board.turn
            score = white_eval.pov(winner)

            cooked = self._cook_from(board.copy(stack=False), winner, prev_score, score)
            if cooked is not None:
                return GamePuzzle(
                    node=node,
                    mistake_ply=ply,
                    cooked=cooked,
                    swing_cp=_swing_cp(prev_score, score),
                )

            prev_score = -score
        return None


@dataclass
class GamePuzzle:
    node: "chess.pgn.ChildNode"
    mistake_ply: int
    cooked: CookedPuzzle
    swing_cp: Optional[int]


def cp_to_score(cp: int, mate_threshold: int = 90_000, mate_score: int = 100_000) -> Score:
    """Rebuild a python-chess Score from a stored centipawn value (mate-coded)."""
    if abs(cp) >= mate_threshold:
        distance = mate_score - abs(cp)
        return Mate(distance if cp > 0 else -distance)
    return Cp(cp)


def _swing_cp(prev_score: Score, score: Score) -> Optional[int]:
    a, b = prev_score.score(), score.score()
    if a is None or b is None:
        return None
    return b - a
