from __future__ import annotations

import chess

from chesspipe import heuristics


def test_clear_exchange_sacrifice_becomes_candidate() -> None:
    board = chess.Board("3k4/8/3p4/4p3/8/8/8/4R1K1 w - - 0 1")
    move = chess.Move.from_uci("e1e5")

    assert heuristics.brilliant_candidate(board, move) >= 100


def test_sound_unique_best_sacrifice_is_brilliant() -> None:
    assert heuristics.is_brilliant_move(
        centipawn_loss=0,
        played_best=True,
        eval_before_cp=20,
        eval_after_cp=260,
        sacrifice_cp=400,
        best_cp=260,
        second_best_cp=80,
    )


def test_small_alternative_gap_is_not_brilliant() -> None:
    assert not heuristics.is_brilliant_move(
        centipawn_loss=0,
        played_best=True,
        eval_before_cp=20,
        eval_after_cp=260,
        sacrifice_cp=400,
        best_cp=260,
        second_best_cp=210,
    )


def test_losing_or_already_trivially_winning_sacrifice_is_not_brilliant() -> None:
    common = {
        "centipawn_loss": 0,
        "played_best": True,
        "sacrifice_cp": 400,
        "best_cp": 300,
        "second_best_cp": 0,
    }
    assert not heuristics.is_brilliant_move(
        **common,
        eval_before_cp=10,
        eval_after_cp=-150,
    )
    assert not heuristics.is_brilliant_move(
        **common,
        eval_before_cp=700,
        eval_after_cp=800,
    )


def test_category_only_uses_verified_brilliant_flag() -> None:
    assert heuristics.classify_category(0, True, -400, 20) == "best"
    assert heuristics.classify_category(0, True, 20, 260, brilliant=True) == "brilliant"
