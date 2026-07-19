"""OpenFile's local chess analysis pipeline.

Stages (each independently runnable, DB state machine on player_games.status):
    ingest -> select -> analyze -> generate -> solve
"""

__all__ = ["__version__"]

__version__ = "0.3.0"
