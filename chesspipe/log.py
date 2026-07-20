from __future__ import annotations

from datetime import datetime, timezone


def log(message: str) -> None:
    """Timestamped stdout line, flushed for tail-friendly job logs."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now} UTC] {message}", flush=True)
