#!/usr/bin/env python3
"""Render puzzles to a local HTML file you can open in a browser.

No Telegram, no Cairo, and (in the default 'candidates' mode) no puzzles table
required — it computes puzzles in memory from existing move analyses using the
exact same logic the generator uses to store them.

Examples:
    python scripts/preview_puzzles.py                      # candidates -> puzzles.html
    python scripts/preview_puzzles.py --mode stored        # from the puzzles table
    python scripts/preview_puzzles.py --phase endgame --limit 30
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from psycopg.rows import dict_row  # noqa: E402

from analysis_cron.config import Settings  # noqa: E402
from analysis_cron.db import get_connection  # noqa: E402
from analysis_cron.puzzles.generator import _candidate_rows, evaluate_candidate  # noqa: E402
from analysis_cron.puzzles.quality import QualityConfig  # noqa: E402
from analysis_cron.puzzles.render_html import render_gallery  # noqa: E402


def _from_candidates(conn, settings: Settings, phase: str | None) -> list[dict]:
    config = QualityConfig(
        min_cp_loss=settings.puzzle_min_centipawn_loss,
        min_top_gap_cp=settings.puzzle_min_top_score_gap_cp,
        solution_eval_floor_cp=settings.puzzle_solution_eval_floor_cp,
        solution_eval_ceiling_cp=settings.puzzle_solution_eval_ceiling_cp,
    )
    records: list[dict] = []
    for row in _candidate_rows(conn):
        record, _ = evaluate_candidate(row, config)
        if record is None:
            continue
        if phase and record["phase"] != phase:
            continue
        records.append(record)
    records.sort(key=lambda r: r["quality_score"], reverse=True)
    return records


def _from_stored(conn, phase: str | None) -> list[dict]:
    clause = "WHERE phase = %s" if phase else ""
    params = (phase,) if phase else ()
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT * FROM puzzles {clause} ORDER BY COALESCE(quality_score, 0) DESC",
            params,
        )
        return [dict(r) for r in cur.fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Render puzzles to a local HTML file.")
    parser.add_argument("--mode", choices=("candidates", "stored"), default="candidates")
    parser.add_argument("--phase", choices=("opening", "middlegame", "endgame"), default=None)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--out", default="puzzles.html")
    parser.add_argument("--no-open", action="store_true", help="Do not open the file in a browser.")
    args = parser.parse_args()

    settings = Settings.from_env()
    with get_connection(settings.database_url, settings.db_schema) as conn:
        if args.mode == "candidates":
            puzzles = _from_candidates(conn, settings, args.phase)
        else:
            puzzles = _from_stored(conn, args.phase)

    puzzles = puzzles[: args.limit]
    title = f"Puzzles ({args.mode}" + (f", {args.phase}" if args.phase else "") + ")"
    out_path = Path(args.out).resolve()
    out_path.write_text(render_gallery(puzzles, title=title), encoding="utf-8")

    print(f"Wrote {len(puzzles)} puzzles to {out_path}")
    if not args.no_open:
        webbrowser.open(out_path.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
