"""Engine backend selection.

``build_engine(settings)`` returns a local or remote :class:`EngineClient`
based on ``ENGINE_MODE``. Both implement the same interface, so callers never
branch on the backend.
"""

from chesspipe.engine.base import EngineClient, Line
from chesspipe.engine.factory import build_engine, engine_identity

__all__ = ["EngineClient", "Line", "build_engine", "engine_identity"]
