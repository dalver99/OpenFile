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
    stockfish_mode: str
    stockfish_api_url: str
    stockfish_api_key: str
    stockfish_path: str
    stockfish_threads: int
    stockfish_hash_mb: int
    stockfish_depth: int
    stockfish_local_depth: int
    stockfish_multipv: int
    stockfish_analyze_game_timeout_sec: int
    max_sync_games: int
    heuristic_version: int
    server_schema_version: int
    recent_archive_months: int
    chesscom_sync_fresh_days: int
    analysis_run_stale_minutes: int
    timezone: ZoneInfo
    user_agent: str
    telegram_bot_token: str | None
    telegram_daily_send_hour: int
    telegram_daily_send_minute: int
    telegram_default_daily_quota: int
    puzzle_min_centipawn_loss: int
    puzzle_min_top_score_gap_cp: int
    puzzle_solution_eval_floor_cp: int
    puzzle_solution_eval_ceiling_cp: int

    @classmethod
    def from_env(cls) -> "Settings":
        timezone_name = os.getenv("CCRON_TIMEZONE", "UTC")
        raw_depth = int(os.getenv("STOCKFISH_DEPTH", "12"))
        depth = min(max(raw_depth, 1), MAX_ANALYZE_GAME_DEPTH)

        stockfish_mode = os.getenv("STOCKFISH_MODE", "api").strip().lower()
        if stockfish_mode not in ("api", "local"):
            raise RuntimeError(
                f"Invalid STOCKFISH_MODE={stockfish_mode!r}; expected 'api' or 'local'."
            )
        # The API key is only required when talking to a remote Stockfish service.
        stockfish_api_key = os.getenv("STOCKFISH_API_KEY", "")
        if stockfish_mode == "api" and not stockfish_api_key:
            raise RuntimeError(
                "Missing required environment variable: STOCKFISH_API_KEY "
                "(required when STOCKFISH_MODE=api)"
            )

        return cls(
            database_url=_require_env("DATABASE_URL"),
            db_schema=os.getenv("DB_SCHEMA", "user_chess_analysis"),
            target_user_id=int(os.getenv("TARGET_USER_ID", "1")),
            stockfish_mode=stockfish_mode,
            stockfish_api_url=os.getenv("STOCKFISH_API_URL", "http://127.0.0.1:8000").rstrip("/"),
            stockfish_api_key=stockfish_api_key,
            stockfish_path=os.getenv("STOCKFISH_PATH", "stockfish"),
            stockfish_threads=max(1, int(os.getenv("STOCKFISH_THREADS", "1"))),
            stockfish_hash_mb=max(16, int(os.getenv("STOCKFISH_HASH_MB", "128"))),
            stockfish_depth=depth,
            stockfish_local_depth=min(
                max(int(os.getenv("STOCKFISH_LOCAL_DEPTH", "21")), 1),
                MAX_ANALYZE_GAME_DEPTH,
            ),
            stockfish_multipv=int(os.getenv("STOCKFISH_MULTIPV", "3")),
            stockfish_analyze_game_timeout_sec=min(
                7200,
                max(30, int(os.getenv("STOCKFISH_ANALYZE_GAME_TIMEOUT_SEC", str(20 * 60)))),
            ),
            max_sync_games=int(os.getenv("MAX_SYNC_GAMES", "40")),
            heuristic_version=int(os.getenv("HEURISTIC_VERSION", "1")),
            server_schema_version=int(os.getenv("SERVER_SCHEMA_VERSION", "1")),
            recent_archive_months=int(os.getenv("RECENT_ARCHIVE_MONTHS", "1")),
            chesscom_sync_fresh_days=max(0, int(os.getenv("CHESSCOM_SYNC_FRESH_DAYS", "7"))),
            analysis_run_stale_minutes=max(1, int(os.getenv("ANALYSIS_RUN_STALE_MINUTES", "60"))),
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
            puzzle_min_centipawn_loss=max(0, int(os.getenv("PUZZLE_MIN_CP_LOSS", "150"))),
            puzzle_min_top_score_gap_cp=max(0, int(os.getenv("PUZZLE_MIN_TOP_SCORE_GAP_CP", "120"))),
            puzzle_solution_eval_floor_cp=int(os.getenv("PUZZLE_SOLUTION_EVAL_FLOOR_CP", "-150")),
            puzzle_solution_eval_ceiling_cp=max(0, int(os.getenv("PUZZLE_SOLUTION_EVAL_CEILING_CP", "0"))),
        )

    def effective_analysis_depth(self, override: int | None = None) -> int:
        """Analysis depth to use, respecting engine mode and an optional CLI override.

        Local Stockfish defaults to a deeper search (STOCKFISH_LOCAL_DEPTH, 21)
        than the remote API mode, since we control the hardware and time budget.
        """
        if override is not None:
            raw = override
        elif self.stockfish_mode == "local":
            raw = self.stockfish_local_depth
        else:
            raw = self.stockfish_depth
        return min(max(raw, 1), MAX_ANALYZE_GAME_DEPTH)
