"""Construct the configured chess engine adapter."""

from __future__ import annotations

from chesspipe.config import Settings
from chesspipe.engine.base import EngineClient
from chesspipe.engine.local import LocalEngine


def build_engine(settings: Settings) -> EngineClient:
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


def engine_identity(settings: Settings) -> str:
    """Return the stable backend identity stored with each analysis."""
    return f"local:{settings.stockfish_path}"
