import io
from dataclasses import dataclass

import chess
import chess.pgn


@dataclass(frozen=True)
class ParsedMove:
    move_number: int
    ply: int
    color: str
    san: str
    uci: str
    fen_before: str
    fen_after: str


@dataclass(frozen=True)
class ParsedGame:
    headers: dict[str, str]
    moves: list[ParsedMove]


def parse_pgn(pgn_text: str) -> ParsedGame:
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Could not parse PGN.")

    board = game.board()
    moves: list[ParsedMove] = []
    for ply, move in enumerate(game.mainline_moves(), start=1):
        color = "white" if board.turn == chess.WHITE else "black"
        move_number = board.fullmove_number
        fen_before = board.fen()
        san = board.san(move)
        uci = move.uci()
        board.push(move)
        moves.append(
            ParsedMove(
                move_number=move_number,
                ply=ply,
                color=color,
                san=san,
                uci=uci,
                fen_before=fen_before,
                fen_after=board.fen(),
            )
        )

    return ParsedGame(headers=dict(game.headers), moves=moves)

