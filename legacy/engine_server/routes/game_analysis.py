import asyncio

from fastapi import APIRouter, HTTPException

from schemas import GameAnalyzeRequest
from state import engine_manager


router = APIRouter()


@router.post("/analyze-game")
async def analyze_game(payload: GameAnalyzeRequest) -> dict:
    try:
        return await asyncio.to_thread(engine_manager.analyze_game, payload)
    except Exception as exc:  # pragma: no cover - returns user-safe API error
        raise HTTPException(status_code=400, detail=str(exc)) from exc
