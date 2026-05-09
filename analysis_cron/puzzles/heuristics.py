from __future__ import annotations

from typing import Any

import chess


def _extract_score_cp(entry: dict[str, Any]) -> int | None:
    for key in ("score_cp", "cp", "eval_cp", "evaluation_cp"):
        value = entry.get(key)
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return None


def _extract_move_uci(entry: dict[str, Any]) -> str | None:
    for key in ("best_move", "move_uci", "move", "uci"):
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_pv_moves(entry: dict[str, Any]) -> list[str]:
    pv = entry.get("pv")
    if not isinstance(pv, list):
        return []
    out: list[str] = []
    for move in pv:
        if isinstance(move, str) and move.strip():
            out.append(move.strip())
    return out


def classify_phase(board: chess.Board) -> str:
    if board.fullmove_number <= 12:
        return "opening"

    queens = 0
    minors = 0
    non_king_non_pawn = 0
    for piece in board.piece_map().values():
        if piece.piece_type in (chess.KING, chess.PAWN):
            continue
        non_king_non_pawn += 1
        if piece.piece_type == chess.QUEEN:
            queens += 1
        elif piece.piece_type in (chess.BISHOP, chess.KNIGHT):
            minors += 1

    if non_king_non_pawn <= 6 or (queens == 0 and minors <= 4):
        return "endgame"
    return "middlegame"


def classify_tag(board: chess.Board, best_line: dict[str, Any]) -> str:
    pv_moves = _extract_pv_moves(best_line)[:2]
    if not pv_moves:
        return "mixed"

    probe = board.copy(stack=False)
    for uci in pv_moves:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            return "mixed"
        is_capture = probe.is_capture(move)
        probe.push(move)
        gives_check = probe.is_check()
        if is_capture or gives_check:
            return "tactical"
    return "strategic"


def is_quality_puzzle(move_row: dict[str, Any]) -> bool:
    cp_loss = move_row.get("centipawn_loss")
    try:
        if cp_loss is None or int(cp_loss) < 150:
            return False
    except (TypeError, ValueError):
        return False

    top_moves = move_row.get("top_moves")
    if not isinstance(top_moves, list) or len(top_moves) < 2:
        return False

    best = top_moves[0] if isinstance(top_moves[0], dict) else None
    second = top_moves[1] if isinstance(top_moves[1], dict) else None
    if best is None or second is None:
        return False

    best_move = _extract_move_uci(best)
    if not best_move:
        return False

    s1 = _extract_score_cp(best)
    s2 = _extract_score_cp(second)
    if s1 is None or s2 is None:
        return False

    return (s1 - s2) >= 80


def extract_solution_uci(top_moves: list[dict[str, Any]]) -> str | None:
    if not top_moves:
        return None
    first = top_moves[0] if isinstance(top_moves[0], dict) else {}
    return _extract_move_uci(first)


def extract_top_scores(top_moves: list[dict[str, Any]]) -> tuple[int | None, int | None]:
    if not top_moves:
        return (None, None)
    first = top_moves[0] if isinstance(top_moves[0], dict) else {}
    second = top_moves[1] if len(top_moves) > 1 and isinstance(top_moves[1], dict) else {}
    return (_extract_score_cp(first), _extract_score_cp(second))

