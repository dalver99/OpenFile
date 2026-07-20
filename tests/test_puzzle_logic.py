"""Tests for the pure puzzle logic (phase + theme detection).

Runs with plain Python (no pytest required):

    venv/bin/python tests/test_puzzle_logic.py

If pytest is installed, `pytest tests/` also discovers these.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chess

from chesspipe.puzzle.phase import ENDGAME, MIDDLEGAME, OPENING, classify_phase
from chesspipe.puzzle.themes import detect_themes, static_exchange_eval


# --- static exchange evaluation ------------------------------------------- #
def test_see_free_capture_and_bad_capture():
    free = chess.Board("4k3/8/8/4p3/8/8/8/4R1K1 w - - 0 1")
    assert static_exchange_eval(free, chess.Move.from_uci("e1e5")) == 100

    defended = chess.Board("3k4/8/3p4/4p3/8/8/8/4R1K1 w - - 0 1")
    assert static_exchange_eval(defended, chess.Move.from_uci("e1e5")) < 0


# --- phase ----------------------------------------------------------------- #
def test_phase_opening_middlegame_endgame():
    assert classify_phase(chess.Board()) == OPENING
    assert classify_phase(chess.Board("8/5k2/8/8/3P4/8/5K2/8 w - - 0 1")) == ENDGAME
    mid = chess.Board("r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 0 6")
    assert classify_phase(mid) == MIDDLEGAME


# --- themes ---------------------------------------------------------------- #
def test_theme_fork():
    b = chess.Board("8/8/1r3k2/8/8/2N5/8/4K3 w - - 0 1")
    primary, themes = detect_themes(b, "c3d5", [], is_mate=False, best_cp=250, played_after_cp=40)
    assert primary == "fork" and "fork" in themes


def test_theme_mate():
    b = chess.Board("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1")
    primary, themes = detect_themes(b, "a1a8", ["a1a8"], is_mate=True, best_cp=100000, played_after_cp=0)
    assert primary == "mate"


def test_theme_discovered_check():
    b = chess.Board("4k3/8/8/8/8/4B3/8/4R1K1 w - - 0 1")
    _, themes = detect_themes(b, "e3b6", [], is_mate=False, best_cp=300, played_after_cp=0)
    assert "discovered_check" in themes


def test_theme_promotion():
    b = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    _, themes = detect_themes(b, "a7a8q", ["a7a8q"], is_mate=False, best_cp=800, played_after_cp=50)
    assert "promotion" in themes


def test_theme_sacrifice():
    b = chess.Board("3k4/8/3p4/4p3/8/8/8/4R1K1 w - - 0 1")
    _, themes = detect_themes(b, "e1e5", [], is_mate=False, best_cp=300, played_after_cp=-200)
    assert "sacrifice" in themes


def test_theme_wins_material():
    b = chess.Board("7k/8/8/8/8/8/8/3rQK2 w - - 0 1")
    _, themes = detect_themes(b, "e1d1", [], is_mate=False, best_cp=400, played_after_cp=-100)
    assert "wins_material" in themes


def test_theme_positional_quiet():
    b = chess.Board("8/8/4k3/8/8/4K3/8/6R1 w - - 0 1")
    primary, _ = detect_themes(b, "g1g7", [], is_mate=False, best_cp=80, played_after_cp=40)
    assert primary == "positional"


def _run_all() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {test.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"ERROR {test.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
