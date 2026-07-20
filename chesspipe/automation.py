"""Friendly cross-platform scheduling for OpenFile's local pipeline."""

from __future__ import annotations

import json
import os
import platform
import plistlib
import shlex
import shutil
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from chesspipe.config import Settings
from chesspipe.log import log
from chesspipe.paths import (
    automation_config_path,
    automation_dir,
    automation_log_path,
    automation_state_path,
    config_path,
)

PRESETS = {"sync", "review", "puzzles"}
FREQUENCIES = {"every_6_hours", "every_12_hours", "daily", "weekly"}
WEEKDAYS = tuple(range(7))
MARKER = "OPENFILE_AUTOMATION"
MAC_LABEL = "org.openfile.automation"
WINDOWS_TASK = "OpenFile-Automation"
MAX_LOG_BYTES = 2_000_000


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _now() -> datetime:
    return datetime.now().astimezone()


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.astimezone()
    except ValueError:
        return None


def normalize_schedule(values: dict[str, Any]) -> dict[str, Any]:
    preset = str(values.get("preset", "puzzles"))
    frequency = str(values.get("frequency", "daily"))
    if preset not in PRESETS:
        raise RuntimeError(f"Unknown routine: {preset}")
    if frequency not in FREQUENCIES:
        raise RuntimeError(f"Unknown frequency: {frequency}")
    try:
        hour = int(values.get("hour", 9))
        weekday = int(values.get("weekday", 0))
        analyze_count = int(values.get("analyze_count", 2))
        puzzle_count = int(values.get("puzzle_count", 2))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Schedule counts, hour, and weekday must be numbers.") from exc
    if not 0 <= hour <= 23:
        raise RuntimeError("hour must be between 0 and 23.")
    if weekday not in WEEKDAYS:
        raise RuntimeError("weekday must be between 0 (Monday) and 6 (Sunday).")
    if not 1 <= analyze_count <= 10:
        raise RuntimeError("analyze_count must be between 1 and 10.")
    if not 1 <= puzzle_count <= 10:
        raise RuntimeError("puzzle_count must be between 1 and 10.")
    return {
        "preset": preset,
        "frequency": frequency,
        "hour": hour,
        "weekday": weekday,
        "analyze_count": analyze_count,
        "puzzle_count": puzzle_count,
    }


def load_schedule() -> dict[str, Any]:
    raw = _read_json(automation_config_path())
    try:
        schedule = normalize_schedule(raw)
    except RuntimeError:
        schedule = normalize_schedule({})
    return {
        **schedule,
        "enabled": bool(raw.get("enabled", False)),
        "provider": raw.get("provider"),
        "installed_at": raw.get("installed_at"),
    }


def _interval(frequency: str) -> timedelta | None:
    if frequency == "every_6_hours":
        return timedelta(hours=6)
    if frequency == "every_12_hours":
        return timedelta(hours=12)
    return None


def is_due(
    schedule: dict[str, Any],
    state: dict[str, Any],
    *,
    now: datetime | None = None,
) -> bool:
    now = now or _now()
    last_attempt = _parse_time(state.get("last_started_at"))
    interval = _interval(str(schedule["frequency"]))
    if interval is not None:
        return last_attempt is None or now >= last_attempt + interval

    target = now.replace(
        hour=int(schedule["hour"]), minute=0, second=0, microsecond=0
    )
    if schedule["frequency"] == "weekly":
        days_back = (now.weekday() - int(schedule["weekday"])) % 7
        target -= timedelta(days=days_back)
    if now < target:
        return False
    if last_attempt is None:
        return True
    if schedule["frequency"] == "daily":
        return last_attempt.date() < now.date()
    return last_attempt < target


def next_run_at(
    schedule: dict[str, Any],
    state: dict[str, Any],
    *,
    now: datetime | None = None,
) -> datetime:
    now = now or _now()
    if is_due(schedule, state, now=now):
        return now
    last_attempt = _parse_time(state.get("last_started_at"))
    interval = _interval(str(schedule["frequency"]))
    if interval is not None:
        return (last_attempt or now) + interval

    target = now.replace(
        hour=int(schedule["hour"]), minute=0, second=0, microsecond=0
    )
    if schedule["frequency"] == "daily":
        if target <= now:
            target += timedelta(days=1)
        return target
    days_ahead = (int(schedule["weekday"]) - now.weekday()) % 7
    target += timedelta(days=days_ahead)
    if target <= now:
        target += timedelta(days=7)
    return target


def _runner_path() -> Path:
    suffix = ".cmd" if platform.system() == "Windows" else ".sh"
    return automation_dir() / f"run{suffix}"


def _write_runner() -> Path:
    root = automation_dir()
    root.mkdir(parents=True, exist_ok=True)
    runner = _runner_path()
    # Keep the virtualenv executable itself; resolving its symlink would drop
    # the environment that contains OpenFile and python-chess.
    python = str(Path(sys.executable).absolute())
    configured = str(config_path().resolve())
    log_path = str(automation_log_path().resolve())
    if platform.system() == "Windows":
        content = (
            "@echo off\r\n"
            f'set "OPENFILE_CONFIG={configured}"\r\n'
            f'"{python}" -m chesspipe.cli automation tick >> "{log_path}" 2>&1\r\n'
        )
    else:
        content = (
            "#!/bin/sh\n"
            f"export OPENFILE_CONFIG={shlex.quote(configured)}\n"
            f"exec {shlex.quote(python)} -m chesspipe.cli automation tick "
            f">> {shlex.quote(log_path)} 2>&1\n"
        )
    runner.write_text(content, encoding="utf-8", newline="")
    if platform.system() != "Windows":
        runner.chmod(0o700)
    return runner


def _run_command(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            args,
            text=True,
            capture_output=True,
            timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(str(exc)) from exc
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "command failed").strip()
        raise RuntimeError(detail)
    return completed


def _mac_plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{MAC_LABEL}.plist"


def _install_launchd(runner: Path) -> str:
    target = _mac_plist_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "Label": MAC_LABEL,
        "ProgramArguments": [str(runner)],
        "RunAtLoad": True,
        "StartInterval": 1800,
        "ProcessType": "Background",
    }
    with target.open("wb") as handle:
        plistlib.dump(payload, handle)
    _run_command(["launchctl", "unload", str(target)], check=False)
    _run_command(["launchctl", "load", "-w", str(target)])
    return "launchd"


def _systemd_paths() -> tuple[Path, Path]:
    root = Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd" / "user"
    return root / "openfile-automation.service", root / "openfile-automation.timer"


def _install_systemd(runner: Path) -> str:
    service, timer = _systemd_paths()
    service.parent.mkdir(parents=True, exist_ok=True)
    escaped_runner = str(runner).replace("\\", "\\\\").replace('"', '\\"')
    service.write_text(
        "[Unit]\nDescription=OpenFile chess routine\n\n"
        "[Service]\nType=oneshot\n"
        f'ExecStart="{escaped_runner}"\n',
        encoding="utf-8",
    )
    timer.write_text(
        "[Unit]\nDescription=Check whether the OpenFile chess routine is due\n\n"
        "[Timer]\nOnBootSec=3min\nOnUnitActiveSec=30min\nPersistent=true\n"
        "Unit=openfile-automation.service\n\n[Install]\nWantedBy=timers.target\n",
        encoding="utf-8",
    )
    _run_command(["systemctl", "--user", "daemon-reload"])
    _run_command(["systemctl", "--user", "enable", "--now", "openfile-automation.timer"])
    return "systemd"


def _cron_lines() -> list[str]:
    completed = _run_command(["crontab", "-l"], check=False)
    if completed.returncode not in (0, 1):
        raise RuntimeError((completed.stderr or "Could not read user crontab.").strip())
    return [line for line in completed.stdout.splitlines() if MARKER not in line]


def _write_crontab(lines: list[str]) -> None:
    try:
        completed = subprocess.run(
            ["crontab", "-"],
            input="\n".join(lines).rstrip() + "\n",
            text=True,
            capture_output=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(str(exc)) from exc
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or "Could not update user crontab.").strip())


def _install_cron(runner: Path) -> str:
    lines = _cron_lines()
    lines.append(f"*/30 * * * * {shlex.quote(str(runner))} # {MARKER}")
    _write_crontab(lines)
    return "cron"


def _install_windows(runner: Path) -> str:
    _run_command([
        "schtasks", "/Create", "/TN", WINDOWS_TASK,
        "/TR", f'"{runner}"', "/SC", "MINUTE", "/MO", "30", "/F",
    ])
    return "task_scheduler"


def _install_native(runner: Path) -> str:
    system = platform.system()
    if system == "Darwin":
        return _install_launchd(runner)
    if system == "Windows":
        return _install_windows(runner)
    if system == "Linux":
        if shutil.which("systemctl"):
            try:
                return _install_systemd(runner)
            except RuntimeError:
                pass
        if shutil.which("crontab"):
            return _install_cron(runner)
        raise RuntimeError("Install systemd or cron to enable OpenFile automation.")
    raise RuntimeError(f"Automation is not supported on {system or 'this platform'}.")


def _uninstall_native(provider: object) -> None:
    if provider == "launchd":
        target = _mac_plist_path()
        _run_command(["launchctl", "unload", "-w", str(target)], check=False)
        target.unlink(missing_ok=True)
    elif provider == "systemd":
        service, timer = _systemd_paths()
        _run_command(
            ["systemctl", "--user", "disable", "--now", "openfile-automation.timer"],
            check=False,
        )
        service.unlink(missing_ok=True)
        timer.unlink(missing_ok=True)
        _run_command(["systemctl", "--user", "daemon-reload"], check=False)
    elif provider == "cron" and shutil.which("crontab"):
        _write_crontab(_cron_lines())
    elif provider == "task_scheduler":
        _run_command(["schtasks", "/Delete", "/TN", WINDOWS_TASK, "/F"], check=False)


def _provider_installed(provider: object) -> bool:
    try:
        if provider == "launchd":
            return _mac_plist_path().is_file()
        if provider == "systemd":
            return all(path.is_file() for path in _systemd_paths())
        if provider == "cron":
            return any(MARKER in line for line in _run_command(["crontab", "-l"], check=False).stdout.splitlines())
        if provider == "task_scheduler":
            return _run_command(
                ["schtasks", "/Query", "/TN", WINDOWS_TASK], check=False
            ).returncode == 0
    except RuntimeError:
        return False
    return False


def enable_schedule(values: dict[str, Any]) -> dict[str, Any]:
    schedule = normalize_schedule(values)
    previous = load_schedule()
    if previous.get("provider"):
        _uninstall_native(previous.get("provider"))
    runner = _write_runner()
    try:
        provider = _install_native(runner)
    except Exception as exc:
        _write_json(automation_config_path(), {**schedule, "enabled": False})
        raise RuntimeError(str(exc)) from exc
    _write_json(automation_config_path(), {
        **schedule,
        "enabled": True,
        "provider": provider,
        "installed_at": _now().isoformat(),
    })
    return automation_status()


def disable_schedule() -> dict[str, Any]:
    schedule = load_schedule()
    try:
        _uninstall_native(schedule.get("provider"))
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc
    _write_json(automation_config_path(), {
        **normalize_schedule(schedule),
        "enabled": False,
        "provider": None,
        "installed_at": schedule.get("installed_at"),
    })
    return automation_status()


def _rotate_log() -> None:
    path = automation_log_path()
    try:
        if path.stat().st_size > MAX_LOG_BYTES:
            path.replace(path.with_suffix(".log.previous"))
    except OSError:
        pass


@contextmanager
def _routine_lock() -> Iterator[bool]:
    path = automation_dir() / "routine.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        try:
            stale = _now().timestamp() - path.stat().st_mtime > 6 * 60 * 60
        except OSError:
            stale = False
        if not stale:
            yield False
            return
        path.unlink(missing_ok=True)
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.write(descriptor, str(os.getpid()).encode())
    os.close(descriptor)
    try:
        yield True
    finally:
        path.unlink(missing_ok=True)


def _record_state(**updates: Any) -> dict[str, Any]:
    state = {**_read_json(automation_state_path()), **updates}
    _write_json(automation_state_path(), state)
    return state


def run_routine(*, trigger: str = "manual") -> dict[str, Any]:
    schedule = load_schedule()
    if not automation_config_path().is_file():
        raise RuntimeError("Save an automation schedule before running it.")
    with _routine_lock() as acquired:
        if not acquired:
            return {"status": "busy", "reason": "routine_already_running"}
        _rotate_log()
        started = _now()
        _record_state(
            status="running",
            trigger=trigger,
            last_started_at=started.isoformat(),
            last_finished_at=None,
            last_error=None,
        )
        log(f"automation: {schedule['preset']} routine started ({trigger})")
        steps: list[dict[str, Any]] = []
        try:
            from chesspipe.stages import (
                analyze_stage,
                generate_stage,
                ingest_stage,
                select_stage,
            )

            settings = Settings.from_env()
            ingest = ingest_stage(settings)
            steps.append(ingest)
            if ingest.get("status") == "failed":
                raise RuntimeError(str(ingest.get("error") or ingest.get("reason") or "sync failed"))

            if schedule["preset"] in {"review", "puzzles"}:
                selected = select_stage(settings, limit=int(schedule["analyze_count"]))
                steps.append(selected)
                for _ in range(int(selected.get("count", 0))):
                    result = analyze_stage(settings)
                    steps.append(result)
                    if result.get("status") == "failed":
                        raise RuntimeError(str(result.get("error") or "analysis failed"))

            if schedule["preset"] == "puzzles":
                for _ in range(int(schedule["puzzle_count"])):
                    result = generate_stage(settings)
                    steps.append(result)
                    if result.get("status") == "failed":
                        raise RuntimeError(str(result.get("error") or "puzzle generation failed"))
                    if result.get("status") == "idle":
                        break

            finished = _now()
            _record_state(
                status="complete",
                last_finished_at=finished.isoformat(),
                last_error=None,
                last_summary={
                    "steps": len(steps),
                    "analyzed": sum(step.get("stage") == "analyze" and step.get("status") == "ok" for step in steps),
                    "puzzles": sum(step.get("stage") == "generate" and step.get("status") == "ok" for step in steps),
                },
            )
            log(f"automation: routine finished in {int((finished - started).total_seconds())}s")
            return {"status": "ok", "steps": steps}
        except Exception as exc:
            _record_state(
                status="failed",
                last_finished_at=_now().isoformat(),
                last_error=str(exc)[:500],
            )
            log(f"automation: routine failed: {exc}")
            return {"status": "failed", "error": str(exc), "steps": steps}


def tick() -> dict[str, Any]:
    schedule = load_schedule()
    state = _read_json(automation_state_path())
    if not schedule["enabled"]:
        return {"status": "idle", "reason": "automation_disabled"}
    if not is_due(schedule, state):
        return {
            "status": "idle",
            "reason": "not_due",
            "next_run_at": next_run_at(schedule, state).isoformat(),
        }
    return run_routine(trigger="scheduled")


def automation_status() -> dict[str, Any]:
    schedule = load_schedule()
    state = _read_json(automation_state_path())
    system = platform.system() or "Unknown"
    available = system in {"Darwin", "Linux", "Windows"}
    installed = _provider_installed(schedule.get("provider")) if schedule["enabled"] else False
    next_run = next_run_at(schedule, state).isoformat() if schedule["enabled"] else None
    return {
        "status": "ok",
        "available": available,
        "platform": system,
        "enabled": schedule["enabled"] and installed,
        "configured_enabled": schedule["enabled"],
        "installed": installed,
        "provider": schedule.get("provider"),
        "schedule": normalize_schedule(schedule),
        "next_run_at": next_run,
        "last_run": state or None,
        "runner": str(_runner_path()),
        "log": str(automation_log_path()),
        "web_ui_required": False,
        "computer_required": True,
        "catch_up": True,
    }
