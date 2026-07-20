"""Tactical/positional theme detection for puzzle positions.

Given the position a solver faces and the engine's best line, labels the
motif(s): forced mate, fork, discovered check, sacrifice, promotion,
material-winning capture, defensive resource, or a quiet positional move. Uses
a static exchange evaluation (SEE) to tell "wins material" from "sacrifices".

Heuristics: precise on the common, clearly-labelable cases; coarse
tactical/positional split otherwise.
"""

from __future__ import annotations

import chess

from chesspipe.material import (
    PIECE_VALUES as _VALUES,
    sacrifice_value,
    static_exchange_eval,
)

_PRIORITY = (
    "mate",
    "fork",
    "sacrifice",
    "discovered_check",
    "promotion",
    "wins_material",
    "defensive",
    "tactical",
    "positional",
)


def _fork_targets(after: chess.Board, from_to_square: int) -> int:
    attacker = after.piece_at(from_to_square)
    if attacker is None:
        return 0
    attacker_value = _VALUES[attacker.piece_type]
    targets = 0
    for square in after.attacks(from_to_square):
        target = after.piece_at(square)
        if target is None or target.color == attacker.color:
            continue
        if target.piece_type == chess.KING:
            targets += 1
            continue
        defended = bool(after.attackers(target.color, square))
        if _VALUES[target.piece_type] > attacker_value or not defended:
            targets += 1
    return targets


def detect_themes(
    board: chess.Board,
    solution_uci: str,
    solution_pv: list[str],
    *,
    is_mate: bool,
    best_cp: int,
    played_after_cp: int,
) -> tuple[str, list[str]]:
    """Return ``(primary_tag, themes)`` for the solver's position."""
    move = chess.Move.from_uci(solution_uci)
    themes: list[str] = []

    gives_check = board.gives_check(move)
    is_capture = board.is_capture(move)
    is_promotion = move.promotion is not None

    after = board.copy(stack=False)
    after.push(move)

    if is_mate or after.is_checkmate():
        themes.append("mate")

    if is_promotion:
        themes.append("promotion")

    if gives_check:
        enemy_king = after.king(after.turn)
        checkers_from = after.attackers(not after.turn, enemy_king) if enemy_king is not None else set()
        if move.to_square not in checkers_from:
            themes.append("discovered_check")

    if _fork_targets(after, move.to_square) >= 2:
        themes.append("fork")

    invests_material = sacrifice_value(board, move) >= 100
    if (is_capture or is_promotion) and static_exchange_eval(board, move) >= 200:
        themes.append("wins_material")

    winning_after = best_cp >= 150 or is_mate
    if invests_material and winning_after:
        themes.append("sacrifice")

    if played_after_cp <= -150 and best_cp >= -80:
        themes.append("defensive")

    forcing = gives_check or is_capture or is_promotion
    if not themes:
        themes.append("tactical" if forcing else "positional")

    primary = next((tag for tag in _PRIORITY if tag in themes), themes[0])
    ordered = [tag for tag in _PRIORITY if tag in themes]
    return primary, ordered
