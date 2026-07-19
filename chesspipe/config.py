"""OpenFile configuration loaded from a cross-platform JSON file and env."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from chesspipe.paths import config_path, database_path
MAX_DEPTH = 30


def load_user_config() -> dict[str, object]:
    path = config_path()
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _value(config: dict[str, object], env: str, key: str, default: str) -> str:
    raw = os.getenv(env)
    if raw is not None and raw.strip():
        return raw.strip()
    configured = config.get(key)
    return str(configured).strip() if configured is not None and str(configured).strip() else default


def _int(config: dict[str, object], env: str, key: str, default: int) -> int:
    try:
        return int(_value(config, env, key, str(default)))
    except ValueError:
        return default


def _clamp_depth(value: int) -> int:
    return min(max(value, 1), MAX_DEPTH)


@dataclass(frozen=True)
class Settings:
    database_url: str
    db_schema: str
    target_user_id: int
    language: str

    stockfish_path: str
    stockfish_threads: int
    stockfish_hash_mb: int

    analysis_depth: int
    analysis_multipv: int
    analysis_deep_depth: int
    analysis_deep_multipv: int
    analysis_deep_threshold_cp: int
    analysis_deep_max_moves: int

    cook_depth: int
    cook_time_sec: float
    puzzle_max_candidates: int
    puzzle_max_solution_plies: int
    puzzle_fallback_min_plies: int

    recent_archive_months: int
    max_sync_games: int
    user_agent: str

    @classmethod
    def from_env(cls) -> "Settings":
        config = load_user_config()
        db_path = os.getenv("OPENFILE_DATABASE_PATH") or _value(
            config, "ROOKLINE_DATABASE_PATH", "database_path", str(database_path())
        )
        database_url = os.getenv("DATABASE_URL", f"sqlite:///{db_path}")
        if not database_url.startswith("sqlite:///"):
            database_url = f"sqlite:///{db_path}"
        return cls(
            database_url=database_url,
            db_schema="",
            target_user_id=_int(config, "TARGET_USER_ID", "target_user_id", 1),
            language=os.getenv("OPENFILE_LANGUAGE") or _value(config, "ROOKLINE_LANGUAGE", "language", "en"),
            stockfish_path=_value(config, "STOCKFISH_PATH", "stockfish_path", "stockfish"),
            stockfish_threads=max(1, _int(config, "STOCKFISH_THREADS", "stockfish_threads", 1)),
            stockfish_hash_mb=max(16, _int(config, "STOCKFISH_HASH_MB", "stockfish_hash_mb", 128)),
            analysis_depth=_clamp_depth(_int(config, "ANALYSIS_DEPTH", "analysis_depth", 16)),
            analysis_multipv=max(1, _int(config, "ANALYSIS_MULTIPV", "analysis_multipv", 1)),
            analysis_deep_depth=_clamp_depth(_int(config, "ANALYSIS_DEEP_DEPTH", "analysis_deep_depth", 20)),
            analysis_deep_multipv=max(1, _int(config, "ANALYSIS_DEEP_MULTIPV", "analysis_deep_multipv", 3)),
            analysis_deep_threshold_cp=max(1, _int(config, "ANALYSIS_DEEP_THRESHOLD_CP", "analysis_deep_threshold_cp", 60)),
            analysis_deep_max_moves=max(0, _int(config, "ANALYSIS_DEEP_MAX_MOVES", "analysis_deep_max_moves", 12)),
            cook_depth=_clamp_depth(_int(config, "COOK_DEPTH", "cook_depth", 19)),
            cook_time_sec=float(_value(config, "COOK_TIME_SEC", "cook_time_sec", "3")),
            puzzle_max_candidates=max(1, _int(config, "PUZZLE_MAX_CANDIDATES", "puzzle_max_candidates", 6)),
            puzzle_max_solution_plies=max(3, _int(config, "PUZZLE_MAX_SOLUTION_PLIES", "puzzle_max_solution_plies", 11)),
            puzzle_fallback_min_plies=max(0, _int(config, "PUZZLE_FALLBACK_MIN_PLIES", "puzzle_fallback_min_plies", 0)),
            recent_archive_months=max(1, _int(config, "RECENT_ARCHIVE_MONTHS", "recent_archive_months", 1)),
            max_sync_games=max(1, _int(config, "MAX_SYNC_GAMES", "max_sync_games", 100)),
            user_agent=_value(config, "CHESSCOM_USER_AGENT", "user_agent", "OpenFile/0.3 (open-source local chess review)"),
        )
