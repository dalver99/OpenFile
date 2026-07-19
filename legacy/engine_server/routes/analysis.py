import asyncio

from fastapi import APIRouter, HTTPException

from schemas import AnalyzeRequest, MultiPVAnalyzeRequest
from state import engine_manager


router = APIRouter()


@router.post("/analyze")
async def analyze(payload: AnalyzeRequest) -> dict:
    try:
        return await asyncio.to_thread(engine_manager.analyze, payload)
    except Exception as exc:  # pragma: no cover - returns user-safe API error
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analyze-multipv")
async def analyze_multipv(payload: MultiPVAnalyzeRequest) -> dict:
    try:
        return await asyncio.to_thread(engine_manager.analyze_multipv, payload)
    except Exception as exc:  # pragma: no cover - returns user-safe API error
        raise HTTPException(status_code=400, detail=str(exc)) from exc
