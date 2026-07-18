from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

MAX_DEPTH = 30


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _clamp_depth(value: int) -> int:
    return min(max(value, 1), MAX_DEPTH)


@dataclass(frozen=True)
class Settings:
    # Database
    database_url: str
    db_schema: str
    target_user_id: int

    # Engine backend: "local" (UCI binary) or "remote" (engine_server HTTP).
    engine_mode: str
    stockfish_path: str
    stockfish_threads: int
    stockfish_hash_mb: int
    engine_api_url: str
    engine_api_key: str
    engine_timeout_sec: int

    # Whole-game analysis (analyze stage).
    analysis_depth: int
    analysis_multipv: int
    analysis_deep_depth: int
    analysis_deep_multipv: int
    analysis_deep_threshold_cp: int
    analysis_deep_max_moves: int

    # Puzzle cooking (generate stage).
    cook_depth: int
    cook_time_sec: float
    puzzle_max_candidates: int
    puzzle_max_solution_plies: int
    puzzle_fallback_min_plies: int

    # Ingest (Chess.com).
    recent_archive_months: int
    max_sync_games: int
    user_agent: str

    # Delivery / Telegram.
    telegram_bot_token: str | None
    telegram_default_daily_quota: int
    delivery_timezone: ZoneInfo

    @classmethod
    def from_env(cls) -> "Settings":
        engine_mode = os.getenv("ENGINE_MODE", "local").strip().lower()
        if engine_mode not in ("local", "remote"):
            raise RuntimeError(
                f"Invalid ENGINE_MODE={engine_mode!r}; expected 'local' or 'remote'."
            )

        engine_api_key = os.getenv("ENGINE_API_KEY", "")
        engine_api_url = os.getenv("ENGINE_API_URL", "http://127.0.0.1:8000").rstrip("/")
        if engine_mode == "remote" and not engine_api_key:
            raise RuntimeError(
                "Missing required environment variable: ENGINE_API_KEY "
                "(required when ENGINE_MODE=remote)"
            )

        return cls(
            database_url=_require("DATABASE_URL"),
            db_schema=os.getenv("DB_SCHEMA", "user_chess_analysis"),
            target_user_id=_int("TARGET_USER_ID", 1),
            engine_mode=engine_mode,
            stockfish_path=os.getenv("STOCKFISH_PATH", "stockfish"),
            stockfish_threads=max(1, _int("STOCKFISH_THREADS", 1)),
            stockfish_hash_mb=max(16, _int("STOCKFISH_HASH_MB", 128)),
            engine_api_url=engine_api_url,
            engine_api_key=engine_api_key,
            engine_timeout_sec=min(7200, max(30, _int("ENGINE_TIMEOUT_SEC", 1200))),
            analysis_depth=_clamp_depth(_int("ANALYSIS_DEPTH", 12)),
            analysis_multipv=max(1, _int("ANALYSIS_MULTIPV", 3)),
            analysis_deep_depth=_clamp_depth(_int("ANALYSIS_DEEP_DEPTH", 20)),
            analysis_deep_multipv=max(1, _int("ANALYSIS_DEEP_MULTIPV", 3)),
            analysis_deep_threshold_cp=max(
                1, _int("ANALYSIS_DEEP_THRESHOLD_CP", 60)
            ),
            analysis_deep_max_moves=max(
                0, _int("ANALYSIS_DEEP_MAX_MOVES", 12)
            ),
            cook_depth=_clamp_depth(_int("COOK_DEPTH", 19)),
            cook_time_sec=float(os.getenv("COOK_TIME_SEC", "3") or "3"),
            puzzle_max_candidates=max(
                1, _int("PUZZLE_MAX_CANDIDATES", 6)
            ),
            puzzle_max_solution_plies=max(
                3, _int("PUZZLE_MAX_SOLUTION_PLIES", 11)
            ),
            puzzle_fallback_min_plies=max(
                0, _int("PUZZLE_FALLBACK_MIN_PLIES", 0)
            ),
            recent_archive_months=_int("RECENT_ARCHIVE_MONTHS", 1),
            max_sync_games=_int("MAX_SYNC_GAMES", 40),
            user_agent=os.getenv(
                "CHESSCOM_USER_AGENT",
                "cccron/0.2 (contact: set CHESSCOM_USER_AGENT)",
            ),
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
            telegram_default_daily_quota=_int("TELEGRAM_DEFAULT_DAILY_QUOTA", 3),
            delivery_timezone=ZoneInfo(os.getenv("DELIVERY_TIMEZONE", "Asia/Seoul")),
        )
