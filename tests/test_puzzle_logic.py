"""Tests for puzzle phase/theme/quality logic.

Runs with plain Python (no pytest required):

    venv/bin/python tests/test_puzzle_logic.py

If pytest is installed, `pytest tests/` also discovers these.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chess

from analysis_cron.puzzles.phase import ENDGAME, MIDDLEGAME, OPENING, classify_phase
from analysis_cron.puzzles.quality import QualityConfig, evaluate_quality
from analysis_cron.puzzles.scoring import Line, Score, parse_lines
from analysis_cron.puzzles.themes import detect_themes, static_exchange_eval


# --------------------------------------------------------------------------- #
# scoring
# --------------------------------------------------------------------------- #
def test_parse_lines_normal_and_mate():
    top_moves = [
        {"best_move": "e2e4", "score_cp": 30, "score": "+30", "pv": ["e2e4", "e7e5"]},
        {"move": "d2d4", "score": "#3", "pv": ["d2d4"]},
        {"score_cp": 10},  # dropped: no move
    ]
    lines = parse_lines(top_moves)
    assert len(lines) == 2
    assert lines[0].move_uci == "e2e4" and lines[0].score.cp == 30
    assert lines[1].move_uci == "d2d4"
    assert lines[1].score.is_mate and lines[1].score.mate_in == 3


def test_parse_lines_mate_via_large_cp():
    lines = parse_lines([{"move": "a1a8", "score_cp": 99997}, {"move": "b1b2", "score_cp": 5}])
    assert lines[0].score.is_mate and lines[0].score.mate_in == 3


# --------------------------------------------------------------------------- #
# static exchange evaluation
# --------------------------------------------------------------------------- #
def test_see_free_capture_and_bad_capture():
    free = chess.Board("4k3/8/8/4p3/8/8/8/4R1K1 w - - 0 1")
    assert static_exchange_eval(free, chess.Move.from_uci("e1e5")) == 100

    defended = chess.Board("3k4/8/3p4/4p3/8/8/8/4R1K1 w - - 0 1")
    assert static_exchange_eval(defended, chess.Move.from_uci("e1e5")) < 0


# --------------------------------------------------------------------------- #
# phase
# --------------------------------------------------------------------------- #
def test_phase_opening_middlegame_endgame():
    assert classify_phase(chess.Board()) == OPENING
    assert classify_phase(chess.Board("8/5k2/8/8/3P4/8/5K2/8 w - - 0 1")) == ENDGAME
    mid = chess.Board("r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 0 6")
    assert classify_phase(mid) == MIDDLEGAME


# --------------------------------------------------------------------------- #
# themes
# --------------------------------------------------------------------------- #
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
    primary, themes = detect_themes(b, "e3b6", [], is_mate=False, best_cp=300, played_after_cp=0)
    assert "discovered_check" in themes


def test_theme_promotion():
    b = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    primary, themes = detect_themes(b, "a7a8q", ["a7a8q"], is_mate=False, best_cp=800, played_after_cp=50)
    assert "promotion" in themes


def test_theme_sacrifice():
    # Rxe5 loses the exchange (pawn defended), but the position is winning.
    b = chess.Board("3k4/8/3p4/4p3/8/8/8/4R1K1 w - - 0 1")
    primary, themes = detect_themes(b, "e1e5", [], is_mate=False, best_cp=300, played_after_cp=-200)
    assert "sacrifice" in themes


def test_theme_wins_material():
    b = chess.Board("7k/8/8/8/8/8/8/3rQK2 w - - 0 1")
    primary, themes = detect_themes(b, "e1d1", [], is_mate=False, best_cp=400, played_after_cp=-100)
    assert "wins_material" in themes


def test_theme_positional_quiet():
    b = chess.Board("8/8/4k3/8/8/4K3/8/6R1 w - - 0 1")
    primary, themes = detect_themes(b, "g1g7", [], is_mate=False, best_cp=80, played_after_cp=40)
    assert primary == "positional"


# --------------------------------------------------------------------------- #
# quality
# --------------------------------------------------------------------------- #
def _lines(cp1, cp2, mate1=False):
    s1 = Score(cp=cp1, is_mate=mate1, mate_in=3 if mate1 else None)
    s2 = Score(cp=cp2, is_mate=False, mate_in=None)
    return [Line("a1a2", s1, []), Line("b1b2", s2, [])]


_CFG = QualityConfig()


def _eval(lines, cp_loss, themes=("wins_material",)):
    return evaluate_quality(
        lines,
        cp_loss,
        themes=list(themes),
        solution_is_forcing=True,
        solution_is_quiet=False,
        solution_is_recapture=False,
        mate_in=None,
        config=_CFG,
    )


def test_quality_accepts_decisive_costly_miss():
    r = _eval(_lines(300, 100), 250)
    assert r.is_quality and r.quality_score > 0 and 1 <= r.difficulty <= 5


def test_quality_rejects_small_gap():
    assert _eval(_lines(120, 110), 250).reject_reason == "best_move_not_decisive"


def test_quality_rejects_low_cp_loss():
    assert _eval(_lines(300, 100), 50).reject_reason == "cp_loss_below_min"


def test_quality_rejects_still_lost():
    assert _eval(_lines(-400, -700), 300).reject_reason == "solution_still_lost"


def test_quality_mate_is_decisive():
    r = _eval(_lines(0, 50, mate1=True), 300, themes=("mate",))
    assert r.is_quality and r.quality_score >= 25


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
