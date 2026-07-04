#!/usr/bin/env python3
"""Rebuild puzzles with the current generation logic.

Deletes only puzzles that have never been delivered (so Telegram delivery
history is preserved), then regenerates from existing move analyses. Safe to
run repeatedly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from analysis_cron.config import Settings  # noqa: E402
from analysis_cron.db import get_connection  # noqa: E402
from analysis_cron.puzzles.generator import generate_pending_puzzles  # noqa: E402


def main() -> int:
    settings = Settings.from_env()
    with get_connection(settings.database_url, settings.db_schema) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM puzzles p
                WHERE NOT EXISTS (
                    SELECT 1 FROM puzzle_deliveries d WHERE d.puzzle_id = p.id
                )
                """
            )
            deleted = cur.rowcount

        result = generate_pending_puzzles(
            conn,
            min_centipawn_loss=settings.puzzle_min_centipawn_loss,
            min_top_score_gap_cp=settings.puzzle_min_top_score_gap_cp,
            solution_eval_floor_cp=settings.puzzle_solution_eval_floor_cp,
            solution_eval_ceiling_cp=settings.puzzle_solution_eval_ceiling_cp,
        )
        conn.commit()

    print(
        json.dumps(
            {"status": "ok", "deleted_undelivered": deleted, **result},
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
