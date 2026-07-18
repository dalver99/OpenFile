"""Construct the configured chess engine adapter."""

from __future__ import annotations

from chesspipe.config import Settings
from chesspipe.engine.base import EngineClient
from chesspipe.engine.local import LocalEngine
from chesspipe.engine.remote import RemoteEngine


def build_engine(settings: Settings) -> EngineClient:
    if settings.engine_mode == "local":
        return LocalEngine(
            settings.stockfish_path,
            threads=settings.stockfish_threads,
            hash_mb=settings.stockfish_hash_mb,
            depth=settings.cook_depth,
            time_sec=settings.cook_time_sec,
            analysis_deep_depth=settings.analysis_deep_depth,
            analysis_deep_multipv=settings.analysis_deep_multipv,
            analysis_deep_threshold_cp=settings.analysis_deep_threshold_cp,
            analysis_deep_max_moves=settings.analysis_deep_max_moves,
        )
    return RemoteEngine(
        settings.engine_api_url,
        settings.engine_api_key,
        depth=settings.cook_depth,
        time_sec=settings.cook_time_sec,
        timeout_sec=settings.engine_timeout_sec,
        analysis_deep_depth=settings.analysis_deep_depth,
        analysis_deep_multipv=settings.analysis_deep_multipv,
        analysis_deep_threshold_cp=settings.analysis_deep_threshold_cp,
        analysis_deep_max_moves=settings.analysis_deep_max_moves,
    )


def engine_identity(settings: Settings) -> str:
    """Return the stable backend identity stored with each analysis."""
    if settings.engine_mode == "local":
        return f"local:{settings.stockfish_path}"
    return settings.engine_api_url
