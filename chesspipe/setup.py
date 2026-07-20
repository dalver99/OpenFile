"""Guided setup and diagnostics for local OpenFile installations."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from chesspipe.config import Settings, load_user_config
from chesspipe.paths import config_path, database_path
from chesspipe.storage.sqlite import initialize_database, path_from_url

MESSAGES = {
    "en": {
        "title": "OpenFile local setup",
        "username": "Chess.com username",
        "stockfish": "Stockfish executable",
        "lichess": "Lichess API token (optional; press Enter to skip)",
        "not_found": "Stockfish was not found automatically. Install it, then paste its executable path.",
        "saved": "Configuration saved",
        "account_ready": "[1/4] Chess.com account",
        "engine_ready": "[2/4] Local engine",
        "integration_ready": "[3/4] Opening enrichment",
        "database_ready": "[4/4] Personal database",
        "optional_off": "optional and disabled",
    },
    "ko": {
        "title": "OpenFile 로컬 설정",
        "username": "Chess.com 사용자 이름",
        "stockfish": "Stockfish 실행 파일",
        "lichess": "Lichess API 토큰 (선택 사항, 건너뛰려면 Enter)",
        "not_found": "Stockfish를 자동으로 찾지 못했습니다. 설치 후 실행 파일 경로를 입력하세요.",
        "saved": "설정을 저장했습니다",
        "account_ready": "[1/4] Chess.com 계정",
        "engine_ready": "[2/4] 로컬 엔진",
        "integration_ready": "[3/4] 오프닝 정보",
        "database_ready": "[4/4] 개인 데이터베이스",
        "optional_off": "선택 사항, 비활성화됨",
    },
}

EDITABLE_SETTINGS: dict[str, type] = {
    "analysis_deep_depth": int,
    "analysis_deep_max_moves": int,
    "analysis_deep_multipv": int,
    "analysis_deep_threshold_cp": int,
    "analysis_depth": int,
    "analysis_multipv": int,
    "chesscom_username": str,
    "cook_depth": int,
    "cook_time_sec": float,
    "language": str,
    "lichess_api_key": str,
    "max_sync_games": int,
    "puzzle_max_candidates": int,
    "puzzle_fallback_min_plies": int,
    "puzzle_max_solution_plies": int,
    "recent_archive_months": int,
    "stockfish_hash_mb": int,
    "stockfish_path": str,
    "stockfish_threads": int,
}


def discover_stockfish(configured: str | None = None) -> str | None:
    candidates: list[Path | str] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    for name in ("stockfish", "stockfish.exe"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    candidates.extend((
        "/opt/homebrew/bin/stockfish",
        "/usr/local/bin/stockfish",
        "/usr/bin/stockfish",
        "/usr/games/stockfish",
    ))
    if platform.system() == "Windows":
        for root_name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA", "USERPROFILE"):
            root = os.getenv(root_name)
            if root:
                base = Path(root) / ("Downloads" if root_name == "USERPROFILE" else "")
                candidates.extend(base.glob("[Ss]tockfish*/stockfish*.exe"))
                candidates.extend(base.glob("[Ss]tockfish*/*/stockfish*.exe"))
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.is_file():
            return str(path.resolve())
    return None


def check_stockfish(path: str) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            [path], input="uci\nquit\n", text=True, capture_output=True, timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    output = f"{completed.stdout}\n{completed.stderr}"
    name = next((line[8:].strip() for line in output.splitlines() if line.startswith("id name ")), "Stockfish")
    return completed.returncode == 0 and "uciok" in output, name


def write_config(values: dict[str, Any]) -> Path:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def configure(
    *, chesscom_username: str | None, stockfish_path: str | None,
    lichess_api_key: str | None,
    language: str = "en", assume_yes: bool = False,
) -> dict[str, Any]:
    language = language if language in MESSAGES else "en"
    text = MESSAGES[language]
    existing = load_user_config()
    print(f"\n{text['title']}\n")
    username = (chesscom_username or str(existing.get("chesscom_username", ""))).strip()
    if not username and not assume_yes:
        username = input(f"{text['username']}: ").strip()
    if not username:
        raise RuntimeError("Chess.com username is required.")
    print(f"{text['account_ready']}: {username.lower()}")

    detected = discover_stockfish(stockfish_path or str(existing.get("stockfish_path", "")))
    if not detected and not assume_yes:
        print(text["not_found"])
        detected = discover_stockfish(input(f"{text['stockfish']}: ").strip())
    if not detected:
        raise RuntimeError("Stockfish was not found. Install Stockfish and rerun `openfile setup`.")
    healthy, engine_name = check_stockfish(detected)
    if not healthy:
        raise RuntimeError(f"Could not start Stockfish at {detected}: {engine_name}")
    print(f"{text['engine_ready']}: {engine_name} ({detected})")

    lichess = lichess_api_key
    if lichess is None:
        existing_token = str(existing.get("lichess_api_key", ""))
        if assume_yes:
            lichess = existing_token
        else:
            suffix = " [configured]" if existing_token else ""
            entered = input(f"{text['lichess']}{suffix}: ").strip()
            lichess = entered or existing_token
    print(f"{text['integration_ready']}: {'configured' if lichess else text['optional_off']}")

    db_path = Path(str(existing.get("database_path") or database_path())).expanduser().resolve()
    initialize_database(db_path)
    print(f"{text['database_ready']}: {db_path}")
    import sqlite3
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """INSERT INTO users (user_id, chessdotcom_id, deleted) VALUES (1, ?, 0)
               ON CONFLICT(user_id) DO UPDATE SET chessdotcom_id=excluded.chessdotcom_id, deleted=0""",
            (username.lower(),),
        )

    values = {
        **existing,
        "chesscom_username": username.lower(),
        "database_path": str(db_path),
        "language": language,
        "lichess_api_key": (lichess or "").strip(),
        "stockfish_path": detected,
        "target_user_id": 1,
    }
    saved = write_config(values)
    return {
        "status": "ok",
        "config": str(saved),
        "database": str(db_path),
        "stockfish": engine_name,
        "next_steps": ["openfile doctor"],
    }


def doctor() -> dict[str, Any]:
    from chesspipe.automation import automation_status

    config = load_user_config()
    settings = Settings.from_env()
    db_path = path_from_url(settings.database_url)
    stockfish = discover_stockfish(settings.stockfish_path)
    engine_ok, engine_detail = check_stockfish(stockfish) if stockfish else (False, "not found")
    node_path = shutil.which("node")
    node_detail = "install Node.js 22.13+"
    node_ok = False
    if node_path:
        try:
            node_version = subprocess.run([node_path, "--version"], text=True, capture_output=True, timeout=3).stdout.strip()
            parts = node_version.removeprefix("v").split(".")
            node_ok = (int(parts[0]), int(parts[1])) >= (22, 13)
            node_detail = node_version if node_ok else f"{node_version}; install Node.js 22.13+"
        except (OSError, ValueError, subprocess.TimeoutExpired):
            node_detail = "could not read Node.js version"
    checks = {
        "config": {"ok": config_path().is_file(), "detail": str(config_path())},
        "database": {"ok": db_path.is_file(), "detail": str(db_path)},
        "chesscom_username": {"ok": bool(config.get("chesscom_username")), "detail": config.get("chesscom_username") or "not configured"},
        "stockfish": {"ok": engine_ok, "detail": engine_detail if engine_ok else f"{engine_detail}; run `openfile setup`"},
        "lichess": {"ok": True, "detail": "configured" if config.get("lichess_api_key") else "optional; book enrichment disabled"},
        "node": {"ok": node_ok, "detail": node_detail},
    }
    schedule = automation_status()
    checks["automation"] = {
        "ok": True,
        "detail": (
            f"enabled via {schedule.get('provider')}"
            if schedule.get("enabled")
            else "optional; disabled"
        ),
    }
    ready = all(item["ok"] for item in checks.values())
    next_steps = [
        "cd webui",
        "npm install    # first launch only",
        "npm run dev",
        "Open http://localhost:3000 and click Sync games",
    ] if ready else ["openfile setup", "openfile doctor"]
    return {
        "status": "ok" if ready else "needs_setup",
        "checks": checks,
        "next_steps": next_steps,
    }


def manage_config(action: str, key: str | None = None, value: str | None = None) -> dict[str, Any]:
    config = load_user_config()
    if action == "path":
        return {"path": str(config_path())}
    if action == "list":
        visible = {
            name: ("configured" if name == "lichess_api_key" and config.get(name) else config.get(name))
            for name in EDITABLE_SETTINGS
            if name in config
        }
        return {"config": visible, "path": str(config_path())}
    if not key or key not in EDITABLE_SETTINGS:
        raise RuntimeError(f"Unknown setting. Choose one of: {', '.join(EDITABLE_SETTINGS)}")
    if action == "get":
        configured = config.get(key)
        return {"key": key, "value": "configured" if key == "lichess_api_key" and configured else configured}
    if action != "set" or value is None:
        raise RuntimeError("Use `openfile config set KEY VALUE`.")

    converter = EDITABLE_SETTINGS[key]
    try:
        converted: Any = converter(value)
    except ValueError as exc:
        raise RuntimeError(f"{key} expects {converter.__name__}.") from exc
    if key == "language" and converted not in MESSAGES:
        raise RuntimeError("language must be 'en' or 'ko'.")
    if key == "stockfish_path":
        detected = discover_stockfish(str(converted))
        if not detected:
            raise RuntimeError("Stockfish executable not found at that path.")
        healthy, detail = check_stockfish(detected)
        if not healthy:
            raise RuntimeError(f"Stockfish check failed: {detail}")
        converted = detected

    config[key] = converted
    write_config(config)
    if key == "chesscom_username":
        settings = Settings.from_env()
        db_path = path_from_url(settings.database_url)
        initialize_database(db_path)
        import sqlite3
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """INSERT INTO users (user_id, chessdotcom_id, deleted) VALUES (1, ?, 0)
                   ON CONFLICT(user_id) DO UPDATE SET chessdotcom_id=excluded.chessdotcom_id, deleted=0""",
                (str(converted).lower(),),
            )
    return {"status": "ok", "key": key, "value": "configured" if key == "lichess_api_key" and converted else converted}
