import secrets
from typing import Optional

from fastapi import Header, HTTPException, status

from config import STOCKFISH_API_KEY


def require_api_key(
    x_stockfish_api_key: Optional[str] = Header(default=None, alias="X-Stockfish-Api-Key"),
) -> None:
    if not STOCKFISH_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="STOCKFISH_API_KEY is not configured.",
        )
    if not x_stockfish_api_key or not secrets.compare_digest(x_stockfish_api_key, STOCKFISH_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
        )
