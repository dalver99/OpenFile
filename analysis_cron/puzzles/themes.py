"""Tactical/positional theme detection for puzzle positions.

Given the position a solver faces and the engine's best line, this module
labels the motif(s): forced mate, fork, discovered check, sacrifice,
promotion, material-winning capture, defensive resource, or a quiet
positional move. It uses a static exchange evaluation (SEE) to distinguish
"wins material" from "sacrifices material".

These are heuristics. They favor precision on the common, clearly-labelable
cases and fall back to a coarse tactical/positional split otherwise.
"""

from __future__ import annotations

import chess

# Rough centipawn piece values used only for exchange/threat reasoning.
_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}

# Priority order when picking a single representative tag.
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


def _value(piece: chess.Piece | None) -> int:
    return _VALUES.get(piece.piece_type, 0) if piece else 0


def _lva_capture(board: chess.Board, to_square: int) -> chess.Move | None:
    """Least-valuable legal capture onto ``to_square`` for the side to move."""
    best_move: chess.Move | None = None
    best_value: int | None = None
    for from_square in board.attackers(board.turn, to_square):
        piece = board.piece_at(from_square)
        if piece is None:
            continue
        promotion = None
        if piece.piece_type == chess.PAWN and chess.square_rank(to_square) in (0, 7):
            promotion = chess.QUEEN
        move = chess.Move(from_square, to_square, promotion=promotion)
        if not board.is_legal(move):
            continue
        value = _VALUES[piece.piece_type]
        if best_value is None or value < best_value:
            best_value = value
            best_move = move
    return best_move


def static_exchange_eval(board: chess.Board, move: chess.Move) -> int:
    """Net material (centipawns, mover POV) of the capture sequence on the target square.

    Positive means the initial capture wins material assuming best play from
    both sides; negative means it loses material. Uses real board pushes so
    x-ray attackers and pin legality are handled naturally.
    """
    to_square = move.to_square
    if board.is_en_passant(move):
        captured = _VALUES[chess.PAWN]
    else:
        captured = _value(board.piece_at(to_square))

    board = board.copy(stack=False)
    board.push(move)

    on_square = _VALUES[move.promotion] if move.promotion else _value_at_after(board, to_square)
    gains = [captured + (_VALUES[move.promotion] - _VALUES[chess.PAWN] if move.promotion else 0)]

    while True:
        recapture = _lva_capture(board, to_square)
        if recapture is None:
            break
        gains.append(on_square - gains[-1])
        capturing_value = _value(board.piece_at(recapture.from_square))
        on_square = _VALUES[recapture.promotion] if recapture.promotion else capturing_value
        board.push(recapture)

    for i in range(len(gains) - 1, 0, -1):
        gains[i - 1] = -max(-gains[i - 1], gains[i])
    return gains[0]


def _value_at_after(board: chess.Board, square: int) -> int:
    return _value(board.piece_at(square))


def _fork_targets(after: chess.Board, from_to_square: int) -> int:
    """Count valuable enemy targets attacked by the piece now on ``from_to_square``."""
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


def _hanging_after_quiet_move(after: chess.Board, to_square: int) -> int:
    """Material the opponent can win by capturing the piece just moved to ``to_square``."""
    capture = _lva_capture(after, to_square)
    if capture is None:
        return 0
    return static_exchange_eval(after, capture)


def detect_themes(
    board: chess.Board,
    solution_uci: str,
    solution_pv: list[str],
    *,
    is_mate: bool,
    best_cp: int,
    played_after_cp: int,
) -> tuple[str, list[str]]:
    """Return ``(primary_tag, themes)`` for the solver's position.

    ``best_cp`` is the evaluation (mover POV) after the solution move.
    ``played_after_cp`` is the evaluation (mover POV) after the move actually
    played in the game (used to spot defensive saves).
    """
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

    invests_material = False
    if is_capture or is_promotion:
        see = static_exchange_eval(board, move)
        if see >= 200:
            themes.append("wins_material")
        elif see <= -100:
            invests_material = True
    else:
        if _hanging_after_quiet_move(after, move.to_square) >= 200:
            invests_material = True

    winning_after = best_cp >= 150 or is_mate
    if invests_material and winning_after:
        themes.append("sacrifice")

    if played_after_cp <= -150 and best_cp >= -80:
        themes.append("defensive")

    forcing = gives_check or is_capture or is_promotion
    if not themes:
        themes.append("tactical" if forcing else "positional")

    primary = next((tag for tag in _PRIORITY if tag in themes), themes[0])
    # De-duplicate while preserving priority order for readability.
    ordered = [tag for tag in _PRIORITY if tag in themes]
    return primary, ordered
