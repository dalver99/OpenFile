from __future__ import annotations

from dataclasses import dataclass

from analysis_cron.pgn import ParsedMove
from analysis_cron.stockfish_client import EngineEvaluation


WINNING_CP = 300


@dataclass(frozen=True)
class MoveAnalysis:
    move_number: int
    ply: int
    color: str
    san: str
    uci: str
    category: str
    centipawn_loss: int
    eval_before_cp: int
    eval_after_cp: int
    eval_before_raw: str
    eval_after_raw: str
    best_move_uci: str | None
    played_best_engine_move: bool
    depth: int | None
    pv: list[str]
    note: str


def classify_move(
    parsed_move: ParsedMove,
    before: EngineEvaluation,
    after: EngineEvaluation,
) -> MoveAnalysis:
    best_move = before.pv[0] if before.pv else None
    played_best = best_move == parsed_move.uci

    # The API scores each position from side-to-move perspective. After a move,
    # the side to move is the opponent, so invert it back to the mover's POV.
    eval_before_cp = before.score_cp
    eval_after_cp = -after.score_cp
    centipawn_loss = max(0, eval_before_cp - eval_after_cp)

    category = _category(centipawn_loss, played_best, eval_before_cp, eval_after_cp)
    return MoveAnalysis(
        move_number=parsed_move.move_number,
        ply=parsed_move.ply,
        color=parsed_move.color,
        san=parsed_move.san,
        uci=parsed_move.uci,
        category=category,
        centipawn_loss=centipawn_loss,
        eval_before_cp=eval_before_cp,
        eval_after_cp=eval_after_cp,
        eval_before_raw=before.score_raw,
        eval_after_raw=after.score_raw,
        best_move_uci=best_move,
        played_best_engine_move=played_best,
        depth=before.depth,
        pv=before.pv,
        note=_note(category, centipawn_loss, played_best, eval_before_cp, eval_after_cp),
    )


def summarize_moves(moves: list[MoveAnalysis]) -> dict[str, int]:
    summary = {
        "brilliant": 0,
        "great": 0,
        "best": 0,
        "good": 0,
        "inaccuracy": 0,
        "mistake": 0,
        "blunder": 0,
    }
    for move in moves:
        summary[move.category] = summary.get(move.category, 0) + 1
    return summary


def _category(
    centipawn_loss: int,
    played_best: bool,
    eval_before_cp: int,
    eval_after_cp: int,
) -> str:
    if played_best and eval_before_cp <= -WINNING_CP and eval_after_cp >= 0:
        return "brilliant"
    if centipawn_loss <= 10 and played_best:
        return "best"
    if centipawn_loss <= 25:
        return "great" if eval_after_cp > eval_before_cp + 75 else "good"
    if centipawn_loss <= 70:
        return "inaccuracy"
    if centipawn_loss <= 180:
        return "mistake"
    return "blunder"


def _note(
    category: str,
    centipawn_loss: int,
    played_best: bool,
    eval_before_cp: int,
    eval_after_cp: int,
) -> str:
    if category == "brilliant":
        return "Engine-top move that turns a clearly worse position into at least equal."
    if category == "best":
        return "Matches Stockfish's first principal-variation move with negligible loss."
    if category == "great":
        return "Improves the evaluation substantially with little or no engine loss."
    if category == "good":
        return "Keeps the evaluation stable within the normal noise range."
    if category == "inaccuracy":
        return f"Loses {centipawn_loss} cp; worth reviewing, but not usually decisive."
    if category == "mistake":
        return f"Loses {centipawn_loss} cp and changes the position meaningfully."
    if category == "blunder":
        return f"Loses {centipawn_loss} cp, likely a tactical or strategic turning point."
    best_text = "engine top move" if played_best else "not engine top move"
    return f"{best_text}; evaluation changed from {eval_before_cp} to {eval_after_cp} cp."

