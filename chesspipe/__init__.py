"""chesspipe: a database-driven chess puzzle pipeline.

Stages (each independently runnable, DB state machine on player_games.status):
    ingest -> select -> analyze -> generate -> send/solve
"""

__all__ = ["__version__"]

__version__ = "0.2.0"
