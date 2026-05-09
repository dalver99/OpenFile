from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


load_dotenv()

MAX_ANALYZE_GAME_DEPTH = 30


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    db_schema: str
    target_user_id: int
    stockfish_api_url: str
    stockfish_api_key: str
    stockfish_depth: int
    stockfish_multipv: int
    max_sync_games: int
    heuristic_version: int
    server_schema_version: int
    recent_archive_months: int
    timezone: ZoneInfo
    user_agent: str
    telegram_bot_token: str | None
    telegram_daily_send_hour: int
    telegram_daily_send_minute: int
    telegram_default_daily_quota: int

    @classmethod
    def from_env(cls) -> "Settings":
        timezone_name = os.getenv("CCRON_TIMEZONE", "UTC")
        raw_depth = int(os.getenv("STOCKFISH_DEPTH", "12"))
        depth = min(max(raw_depth, 1), MAX_ANALYZE_GAME_DEPTH)
        return cls(
            database_url=_require_env("DATABASE_URL"),
            db_schema=os.getenv("DB_SCHEMA", "user_chess_analysis"),
            target_user_id=int(os.getenv("TARGET_USER_ID", "1")),
            stockfish_api_url=os.getenv("STOCKFISH_API_URL", "http://127.0.0.1:8000").rstrip("/"),
            stockfish_api_key=_require_env("STOCKFISH_API_KEY"),
            stockfish_depth=depth,
            stockfish_multipv=int(os.getenv("STOCKFISH_MULTIPV", "3")),
            max_sync_games=int(os.getenv("MAX_SYNC_GAMES", "40")),
            heuristic_version=int(os.getenv("HEURISTIC_VERSION", "1")),
            server_schema_version=int(os.getenv("SERVER_SCHEMA_VERSION", "1")),
            recent_archive_months=int(os.getenv("RECENT_ARCHIVE_MONTHS", "2")),
            timezone=ZoneInfo(timezone_name),
            user_agent=os.getenv(
                "CHESSCOM_USER_AGENT",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36",
            ),
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
            telegram_daily_send_hour=int(os.getenv("TELEGRAM_DAILY_SEND_HOUR", "19")),
            telegram_daily_send_minute=int(os.getenv("TELEGRAM_DAILY_SEND_MINUTE", "30")),
            telegram_default_daily_quota=int(os.getenv("TELEGRAM_DEFAULT_DAILY_QUOTA", "3")),
        )
