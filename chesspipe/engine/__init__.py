"""Engine backend selection.

``build_engine(settings)`` returns the configured local UCI engine.
"""

from chesspipe.engine.base import EngineClient, Line
from chesspipe.engine.factory import build_engine, engine_identity

__all__ = ["EngineClient", "Line", "build_engine", "engine_identity"]
