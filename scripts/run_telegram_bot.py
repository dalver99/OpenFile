#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from analysis_cron.bot.service import run_polling  # noqa: E402
from analysis_cron.config import Settings  # noqa: E402


def main() -> int:
    run_polling(Settings.from_env())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

