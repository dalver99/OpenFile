"""Backward-compatible import for the PostgreSQL storage adapter.

New code should import :func:`chesspipe.storage.get_connection`.
"""

from chesspipe.storage import get_connection

__all__ = ["get_connection"]
