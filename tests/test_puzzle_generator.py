"""Tests for bounded and cached puzzle candidate cooking."""

from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chess
import chess.pgn
from chess.engine import Cp, PovScore

from chesspipe.engine.base import Line
from chesspipe.puzzle.lichess import GeneratorConfig, LichessStyleGenerator


class FakeEngine:
    def __init__(self) -> None:
        self.calls = 0

    def analyse_position(self, board: chess.Board, multipv: int = 1) -> list[Line]:
        self.calls += 1
        moves = list(board.legal_moves)[:multipv]
        return [Line(pv=[move], score=Cp(100 - index * 10)) for index, move in enumerate(moves)]


class RejectingGenerator(LichessStyleGenerator):
    def __init__(self, max_candidates: int) -> None:
        super().__init__(
            FakeEngine(),
            GeneratorConfig(max_candidates=max_candidates),
        )
        self.attempted_plies: list[int] = []

    def _cook_from(self, candidate, min_solution_plies):
        self.attempted_plies.append(candidate.node.ply())
        return None


def _candidate_game() -> tuple[chess.pgn.Game, dict[int, PovScore]]:
    game = chess.pgn.read_game(
        io.StringIO("1. e4 e5 2. Nf3 Nc6 *")
    )
    assert game is not None
    return game, {
        1: PovScore(Cp(10), chess.WHITE),
        2: PovScore(Cp(500), chess.WHITE),
        3: PovScore(Cp(0), chess.WHITE),
        4: PovScore(Cp(800), chess.WHITE),
    }


def test_candidate_budget_prefers_largest_swing():
    game, eval_map = _candidate_game()
    generator = RejectingGenerator(max_candidates=1)

    assert generator.analyze_game(game, eval_map) is None
    assert generator.attempted_plies == [4]
    assert generator.last_stats["candidate_positions"] == 2
    assert generator.last_stats["candidates_attempted"] == 1


def test_multipv_result_is_reused_for_best_defense():
    engine = FakeEngine()
    generator = LichessStyleGenerator(engine)
    generator._reset_stats()
    board = chess.Board()

    assert len(generator._lines(board, multipv=2)) == 2
    assert len(generator._lines(board, multipv=1)) == 1
    assert engine.calls == 1
    assert generator.last_stats["cache_hits"] == 1


def test_default_quality_profile_requires_a_multi_ply_line():
    config = GeneratorConfig()

    assert config.min_solution_plies == 3
    assert config.fallback_min_solution_plies is None
    assert config.allow_mate_in_one is False
    assert config.max_solution_plies == 11


def _run_all() -> int:
    tests = [
        value
        for key, value in sorted(globals().items())
        if key.startswith("test_") and callable(value)
    ]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
