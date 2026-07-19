"""Small, deterministic material helpers shared by review and puzzles."""

from __future__ import annotations

import chess

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20_000,
}


def piece_value(piece: chess.Piece | None) -> int:
    return PIECE_VALUES.get(piece.piece_type, 0) if piece else 0


def least_valuable_capture(board: chess.Board, to_square: int) -> chess.Move | None:
    """Return the least-valuable legal capture onto a square."""
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
        value = PIECE_VALUES[piece.piece_type]
        if best_value is None or value < best_value:
            best_value = value
            best_move = move
    return best_move


def static_exchange_eval(board: chess.Board, move: chess.Move) -> int:
    """Estimate the capture sequence's net material from the mover's POV."""
    to_square = move.to_square
    captured = PIECE_VALUES[chess.PAWN] if board.is_en_passant(move) else piece_value(
        board.piece_at(to_square)
    )

    position = board.copy(stack=False)
    position.push(move)
    on_square = (
        PIECE_VALUES[move.promotion]
        if move.promotion
        else piece_value(position.piece_at(to_square))
    )
    gains = [
        captured
        + (PIECE_VALUES[move.promotion] - PIECE_VALUES[chess.PAWN] if move.promotion else 0)
    ]

    while True:
        recapture = least_valuable_capture(position, to_square)
        if recapture is None:
            break
        gains.append(on_square - gains[-1])
        capturing_value = piece_value(position.piece_at(recapture.from_square))
        on_square = (
            PIECE_VALUES[recapture.promotion]
            if recapture.promotion
            else capturing_value
        )
        position.push(recapture)

    for index in range(len(gains) - 1, 0, -1):
        gains[index - 1] = -max(-gains[index - 1], gains[index])
    return gains[0]


def sacrifice_value(board: chess.Board, move: chess.Move) -> int:
    """Return material deliberately offered by ``move`` in centipawns.

    Captures use static exchange evaluation. Quiet moves count only when the
    moved piece can be profitably captured immediately. This deliberately
    favors clear, explainable sacrifices over speculative positional labels.
    """
    if board.is_capture(move) or move.promotion is not None:
        return max(0, -static_exchange_eval(board, move))

    after = board.copy(stack=False)
    after.push(move)
    reply = least_valuable_capture(after, move.to_square)
    if reply is None:
        return 0
    return max(0, static_exchange_eval(after, reply))
