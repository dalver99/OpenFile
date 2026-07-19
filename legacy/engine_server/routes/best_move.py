import asyncio

from fastapi import APIRouter, HTTPException

from schemas import BestMoveRequest
from state import engine_manager


router = APIRouter()


@router.post("/best-move")
async def best_move(payload: BestMoveRequest) -> dict:
    try:
        move = await asyncio.to_thread(engine_manager.best_move, payload)
        return {"best_move": move}
    except Exception as exc:  # pragma: no cover - returns user-safe API error
        raise HTTPException(status_code=400, detail=str(exc)) from exc
