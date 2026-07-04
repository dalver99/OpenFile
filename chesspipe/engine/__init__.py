"""Engine backend selection.

``build_engine(settings)`` returns a local or remote :class:`EngineClient`
based on ``ENGINE_MODE``. Both implement the same interface, so callers never
branch on the backend.
"""

from __future__ import annotations

from chesspipe.config import Settings
from chesspipe.engine.base import EngineClient, Line
from chesspipe.engine.local import LocalEngine
from chesspipe.engine.remote import RemoteEngine

__all__ = ["EngineClient", "Line", "build_engine", "engine_identity"]


def build_engine(settings: Settings) -> EngineClient:
    if settings.engine_mode == "local":
        return LocalEngine(
            settings.stockfish_path,
            threads=settings.stockfish_threads,
            hash_mb=settings.stockfish_hash_mb,
            depth=settings.cook_depth,
            time_sec=settings.cook_time_sec,
        )
    return RemoteEngine(
        settings.engine_api_url,
        settings.engine_api_key,
        depth=settings.cook_depth,
        time_sec=settings.cook_time_sec,
        timeout_sec=settings.engine_timeout_sec,
    )


def engine_identity(settings: Settings) -> str:
    """Stable string identifying the engine backend, stored with each analysis."""
    if settings.engine_mode == "local":
        return f"local:{settings.stockfish_path}"
    return settings.engine_api_url
