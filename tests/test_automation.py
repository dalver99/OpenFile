"""Pure schedule-rule tests; these never install a native timer."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from chesspipe.automation import _install_native, is_due, next_run_at, normalize_schedule


def schedule(**updates: object) -> dict[str, object]:
    return normalize_schedule({"preset": "puzzles", "frequency": "daily", "hour": 9, **updates})


def test_daily_waits_for_preferred_hour() -> None:
    now = datetime(2026, 7, 20, 8, 30, tzinfo=timezone.utc)
    assert not is_due(schedule(), {}, now=now)
    assert next_run_at(schedule(), {}, now=now) == datetime(2026, 7, 20, 9, 0, tzinfo=timezone.utc)


def test_daily_runs_once_after_preferred_hour() -> None:
    now = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)
    assert is_due(schedule(), {}, now=now)
    state = {"last_started_at": datetime(2026, 7, 20, 9, 5, tzinfo=timezone.utc).isoformat()}
    assert not is_due(schedule(), state, now=now)


def test_interval_uses_last_attempt_to_prevent_retry_storms() -> None:
    now = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)
    state = {"last_started_at": (now - timedelta(hours=5)).isoformat()}
    every_six = schedule(frequency="every_6_hours")
    assert not is_due(every_six, state, now=now)
    assert is_due(every_six, state, now=now + timedelta(hours=1))


def test_weekly_catches_up_after_the_target_time() -> None:
    monday = datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)
    weekly = schedule(frequency="weekly", weekday=0, hour=9)
    assert is_due(weekly, {}, now=monday)
    state = {"last_started_at": monday.isoformat()}
    assert next_run_at(weekly, state, now=monday) == datetime(2026, 7, 27, 9, 0, tzinfo=timezone.utc)


def test_native_provider_dispatches_on_mac_and_windows() -> None:
    runner = Path("/tmp/openfile-runner")
    with patch("chesspipe.automation.platform.system", return_value="Darwin"), patch(
        "chesspipe.automation._install_launchd", return_value="launchd"
    ) as launchd:
        assert _install_native(runner) == "launchd"
        launchd.assert_called_once_with(runner)
    with patch("chesspipe.automation.platform.system", return_value="Windows"), patch(
        "chesspipe.automation._install_windows", return_value="task_scheduler"
    ) as windows:
        assert _install_native(runner) == "task_scheduler"
        windows.assert_called_once_with(runner)


def test_linux_falls_back_to_cron_when_user_systemd_is_unavailable() -> None:
    runner = Path("/tmp/openfile-runner")
    with patch("chesspipe.automation.platform.system", return_value="Linux"), patch(
        "chesspipe.automation.shutil.which", return_value="/usr/bin/tool"
    ), patch(
        "chesspipe.automation._install_systemd", side_effect=RuntimeError("no user bus")
    ), patch(
        "chesspipe.automation._install_cron", return_value="cron"
    ) as cron:
        assert _install_native(runner) == "cron"
        cron.assert_called_once_with(runner)


def _run_all() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_") and callable(value)]
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
