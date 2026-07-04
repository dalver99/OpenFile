#!/usr/bin/env python3
"""Generate Lichess-style forced-sequence puzzles from analyzed games.

Uses a local Stockfish binary (over UCI) to cook and validate each puzzle:
every solver move must be the only good move, and the opponent plays the best
defense. Defaults to a local HTML preview; pass --insert to write to the
puzzles table (requires sql/003_puzzle_quality.sql applied).

Examples:
    python scripts/generate_lichess_puzzles.py --limit-games 10
    python scripts/generate_lichess_puzzles.py --insert
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import chess.engine  # noqa: E402

from analysis_cron.config import Settings  # noqa: E402
from analysis_cron.db import get_connection  # noqa: E402
from analysis_cron.puzzles.generator import insert_puzzle_record  # noqa: E402
from analysis_cron.puzzles.lichess_generator import GeneratorConfig, LichessStyleGenerator  # noqa: E402
from analysis_cron.puzzles.lichess_pipeline import generate_records  # noqa: E402
from analysis_cron.puzzles.render_html import render_gallery  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Lichess-style puzzles.")
    parser.add_argument("--limit-games", type=int, default=None)
    parser.add_argument("--depth", type=int, default=None, help="Cook depth (default: local analysis depth).")
    parser.add_argument("--time", type=float, default=5.0, help="Per-position time cap in seconds.")
    parser.add_argument("--insert", action="store_true", help="Write to the puzzles table.")
    parser.add_argument("--out", default="puzzles.html")
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    settings = Settings.from_env()
    depth = args.depth or settings.effective_analysis_depth()

    engine = chess.engine.SimpleEngine.popen_uci(settings.stockfish_path)
    options = {}
    if "Threads" in engine.options:
        options["Threads"] = settings.stockfish_threads
    if "Hash" in engine.options:
        options["Hash"] = settings.stockfish_hash_mb
    if options:
        engine.configure(options)

    generator = LichessStyleGenerator(engine, GeneratorConfig(depth=depth, time_sec=args.time))
    print(f"cooking with {settings.stockfish_path} at depth {depth}, {args.time}s/position")

    records = []
    try:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            for rec in generate_records(conn, generator, limit_games=args.limit_games, log=print):
                records.append(rec)
            if args.insert:
                inserted = sum(1 for r in records if insert_puzzle_record(conn, r))
                conn.commit()
                print(f"inserted {inserted} puzzles")
    finally:
        engine.quit()

    if not args.insert:
        records.sort(key=lambda r: r["quality_score"], reverse=True)
        out_path = Path(args.out).resolve()
        out_path.write_text(render_gallery(records, title="Lichess-style puzzles"), encoding="utf-8")
        print(f"wrote {len(records)} puzzles to {out_path}")
        if not args.no_open:
            webbrowser.open(out_path.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
