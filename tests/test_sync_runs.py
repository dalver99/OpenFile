"""Tests for persistent, cancellable synchronization status."""

from __future__ import annotations

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chesspipe.ingest.runs import create_sync_run, record_sync_game, update_sync_run
from chesspipe.storage import get_connection


def test_sync_run_records_progress_and_new_games() -> None:
    with TemporaryDirectory() as directory:
        url = f"sqlite:///{Path(directory) / 'openfile.db'}"
        with get_connection(url) as conn:
            conn.execute("INSERT INTO users (user_id, chessdotcom_id) VALUES (?, ?)", (1, "player"))
            conn.execute(
                """INSERT INTO chesscom_games
                   (chesscom_url, white_username, black_username, rules, pgn, raw_json)
                   VALUES (?, ?, ?, 'chess', '*', '{}')""",
                ("https://chess.com/game/1", "player", "opponent"),
            )
            conn.execute(
                """INSERT INTO player_games
                   (player_id, game_id, side, result, status)
                   VALUES (1, 1, 'white', 'win', 'ingested')"""
            )
            run_id = create_sync_run(
                conn,
                user_id=1,
                archive_months=2,
                max_games=100,
                refresh_existing=False,
            )
            update_sync_run(
                conn,
                run_id,
                phase="saving",
                checked=12,
                added=1,
                existing_count=11,
                processed=1,
            )
            record_sync_game(conn, run_id, 1, "rapid")
            conn.commit()

            row = conn.execute(
                """SELECT phase, checked, added, existing_count, processed
                   FROM sync_runs WHERE id = ?""",
                (run_id,),
            ).fetchone()
            linked = conn.execute(
                "SELECT time_class FROM sync_run_games WHERE sync_run_id = ?",
                (run_id,),
            ).fetchone()

        assert tuple(row) == ("saving", 12, 1, 11, 1)
        assert tuple(linked) == ("rapid",)


def test_cancelled_run_cannot_be_overwritten_by_worker_progress() -> None:
    with TemporaryDirectory() as directory:
        url = f"sqlite:///{Path(directory) / 'openfile.db'}"
        with get_connection(url) as conn:
            conn.execute("INSERT INTO users (user_id, chessdotcom_id) VALUES (?, ?)", (1, "player"))
            run_id = create_sync_run(
                conn,
                user_id=1,
                archive_months=1,
                max_games=100,
                refresh_existing=False,
            )
            update_sync_run(conn, run_id, only_if_running=False, status="cancelled", phase="cancelled")
            update_sync_run(conn, run_id, phase="saving", processed=5)
            conn.commit()
            row = conn.execute(
                "SELECT status, phase, processed FROM sync_runs WHERE id = ?",
                (run_id,),
            ).fetchone()

        assert tuple(row) == ("cancelled", "cancelled", 0)


def _run_all() -> int:
    tests = [
        value
        for key, value in sorted(globals().items())
        if key.startswith("test_") and callable(value)
    ]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
