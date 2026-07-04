import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from starlette.requests import Request

from auth import require_api_key
from config import APP_TITLE, APP_VERSION
from routes import routers
from state import engine_manager

_request_log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine_manager.start()
    try:
        yield
    finally:
        engine_manager.stop()


app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    lifespan=lifespan,
    dependencies=[Depends(require_api_key)],
)


@app.middleware("http")
async def log_request_start(request: Request, call_next):
    # Uvicorn access lines usually print when the response is done; long POSTs (e.g.
    # /analyze-game) look "invisible" until then. Log at accept time, skip health polls.
    if not (request.method == "GET" and request.url.path == "/health"):
        _request_log.info("Request started: %s %s", request.method, request.url.path)
    return await call_next(request)


for router in routers:
    app.include_router(router)
