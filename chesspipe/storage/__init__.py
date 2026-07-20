"""Persistence adapters.

SQLite is the default local backend. Keeping it under an explicit adapter
package prevents persistence details from leaking into chess features.
"""

from chesspipe.storage.sqlite import Connection, get_connection, initialize_database

__all__ = ["Connection", "get_connection", "initialize_database"]
