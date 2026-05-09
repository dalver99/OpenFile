#!/usr/bin/env python3
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from analysis_cron.config import Settings  # noqa: E402
from analysis_cron.runner import run_daily_analysis  # noqa: E402


def main() -> int:
    result = run_daily_analysis(Settings.from_env())
    print(json.dumps(result, indent=2, sort_keys=True))
    if result.get("status") == "error":
        return 1
    failed = any(p.get("status") == "failed" for p in result.get("players", []))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

