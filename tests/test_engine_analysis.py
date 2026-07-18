"""Tests for adjacent-position score reuse in whole-game analysis."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chess

from chesspipe.engine.local import MATE_SCORE, _move_metrics


def test_adjacent_position_score_is_inverted():
    before = [{"move": "e2e4", "score_cp": 40}]
    after = [{"move": "e7e5", "score_cp": -25}]
    before_board = chess.Board()
    after_board = before_board.copy()
    after_board.push_uci("e2e4")

    assert _move_metrics(
        before,
        after,
        "e2e4",
        before_board,
        after_board,
    ) == (40, 25, 15, 1)


def test_checkmate_terminal_position_is_winning_for_mover():
    board = chess.Board()
    for move in ("f2f3", "e7e5", "g2g4"):
        board.push_uci(move)
    before_board = board.copy()
    before = [{"move": "d8h4", "score_cp": MATE_SCORE}]
    board.push_uci("d8h4")

    assert board.is_checkmate()
    assert _move_metrics(
        before,
        [],
        "d8h4",
        before_board,
        board,
    ) == (MATE_SCORE, MATE_SCORE, 0, 1)


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
