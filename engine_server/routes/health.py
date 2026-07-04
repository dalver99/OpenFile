from fastapi import APIRouter

from state import engine_manager


router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "stockfish_path": engine_manager.path}
