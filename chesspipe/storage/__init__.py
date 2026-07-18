"""Persistence adapters.

PostgreSQL is the currently supported backend. Keeping it under an explicit
adapter package prevents database-specific behavior from leaking into engine,
ingest, and presentation modules as new storage backends are added.
"""

from chesspipe.storage.postgres import get_connection

__all__ = ["get_connection"]
