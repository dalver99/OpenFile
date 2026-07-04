"""Render puzzles to a self-contained HTML gallery.

Uses python-chess's SVG board output (browsers render it natively), so no
Cairo/native image libraries are required. Solutions hide behind a disclosure
toggle so the page is usable for actual solving.
"""

from __future__ import annotations

import html
from typing import Any

import chess
import chess.svg


def _line_to_san(fen: str, uci_line: list[str], max_plies: int = 8) -> list[str]:
    board = chess.Board(fen)
    sans: list[str] = []
    for uci in list(uci_line)[:max_plies]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        sans.append(board.san(move))
        board.push(move)
    return sans


def _board_svg(fen: str, side_to_move: str, size: int = 360) -> str:
    return chess.svg.board(
        board=chess.Board(fen),
        size=size,
        flipped=(side_to_move == "black"),
        coordinates=True,
    )


def _card(index: int, puzzle: dict[str, Any]) -> str:
    fen = str(puzzle["fen_before"])
    side_to_move = str(puzzle.get("side_to_move", "white"))
    svg = _board_svg(fen, side_to_move)

    difficulty = int(puzzle.get("difficulty") or 0)
    stars = "\u2605" * difficulty + "\u2606" * max(0, 5 - difficulty)

    themes = puzzle.get("themes") or []
    themes_str = ", ".join(themes) if isinstance(themes, list) else str(themes)

    solution = str(puzzle.get("solution_san") or puzzle.get("solution_uci") or "")
    line = _line_to_san(fen, list(puzzle.get("solution_line_uci") or []))
    line_str = " ".join(line) if line else solution

    side = "White" if side_to_move == "white" else "Black"
    goal = "Find the forced mate" if puzzle.get("is_mate") else f"Find the best move for {side}"

    return f"""<div class="card">
  <div class="board">{svg}</div>
  <div class="meta">
    <div class="num">#{index}</div>
    <div class="goal">{html.escape(goal)}</div>
    <div class="tags">Phase: {html.escape(str(puzzle.get('phase', '')))} &middot; Theme: {html.escape(str(puzzle.get('tag', '')))} &middot; {stars}</div>
    <div class="tags">Swing: {puzzle.get('cp_loss')} cp &middot; Quality: {puzzle.get('quality_score')} &middot; {html.escape(themes_str)}</div>
    <details>
      <summary>Show solution</summary>
      <div class="sol">{html.escape(solution)} <span class="line">{html.escape(line_str)}</span></div>
    </details>
  </div>
</div>"""


def render_gallery(puzzles: list[dict[str, Any]], title: str = "Puzzles") -> str:
    cards = "\n".join(_card(i, p) for i, p in enumerate(puzzles, start=1))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  body {{ font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 24px; background: #f4f5f7; color: #1a202c; }}
  h1 {{ font-weight: 600; }}
  .count {{ font-weight: 400; color: #718096; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }}
  .card {{ background: #fff; border-radius: 10px; padding: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }}
  .board svg {{ width: 100%; height: auto; }}
  .meta {{ margin-top: 10px; font-size: 14px; line-height: 1.5; }}
  .num {{ font-weight: 700; color: #a0aec0; }}
  .goal {{ font-weight: 600; }}
  .tags {{ color: #4a5568; font-size: 13px; }}
  details {{ margin-top: 8px; }}
  summary {{ cursor: pointer; color: #2b6cb0; }}
  .sol {{ margin-top: 6px; font-weight: 600; }}
  .line {{ font-weight: 400; color: #718096; }}
</style></head>
<body>
<h1>{html.escape(title)} <span class="count">({len(puzzles)})</span></h1>
<div class="grid">
{cards}
</div>
</body></html>"""
