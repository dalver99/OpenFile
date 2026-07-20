import json
from collections.abc import Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from schemas import StreamAnalyzeRequest
from state import engine_manager


router = APIRouter()


def _sse_events(events: Iterator[dict]) -> Iterator[str]:
    for event in events:
        event_type = event.get("type", "message")
        payload = json.dumps(event, separators=(",", ":"))
        yield f"event: {event_type}\ndata: {payload}\n\n"


@router.post("/analyze-stream")
def analyze_stream(payload: StreamAnalyzeRequest) -> StreamingResponse:
    try:
        return StreamingResponse(
            _sse_events(engine_manager.stream_analyze(payload)),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as exc:  # pragma: no cover - returns user-safe API error
        raise HTTPException(status_code=400, detail=str(exc)) from exc
