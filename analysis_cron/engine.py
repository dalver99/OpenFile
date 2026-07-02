"""Engine backend selection.

Chooses between the remote HTTP Stockfish service and a locally installed
Stockfish binary based on ``Settings.stockfish_mode``. Both backends implement
the same duck-typed interface: ``health()`` and ``analyze_game(pgn, depth, multipv)``.
"""

from __future__ import annotations

from typing import Any, Protocol

from analysis_cron.config import Settings
from analysis_cron.local_engine_client import LocalStockfishClient
from analysis_cron.stockfish_client import StockfishClient


class EngineClient(Protocol):
    def health(self) -> dict[str, Any]:
        ...

    def analyze_game(self, pgn: str, depth: int, multipv: int) -> dict[str, Any]:
        ...


def build_engine_client(settings: Settings) -> EngineClient:
    if settings.stockfish_mode == "local":
        return LocalStockfishClient(
            settings.stockfish_path,
            threads=settings.stockfish_threads,
            hash_mb=settings.stockfish_hash_mb,
            analyze_game_timeout_sec=settings.stockfish_analyze_game_timeout_sec,
        )
    return StockfishClient(
        settings.stockfish_api_url,
        settings.stockfish_api_key,
        analyze_game_timeout_sec=settings.stockfish_analyze_game_timeout_sec,
    )


def engine_identity(settings: Settings) -> str:
    """A stable string identifying the engine backend, stored with each analysis."""
    if settings.stockfish_mode == "local":
        return f"local:{settings.stockfish_path}"
    return settings.stockfish_api_url
