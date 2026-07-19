import json
from urllib import error, parse, request

from fastapi import APIRouter, HTTPException, Query, status

from config import LICHESS_API_KEY


router = APIRouter()


@router.get("/cloud-eval")
def cloud_eval(
    fen: str = Query(..., description="X-FEN of the position."),
    multi_pv: int = Query(1, ge=1, le=5, alias="multiPv"),
    variant: str | None = Query(default=None, description="Chess variant, e.g. standard."),
) -> dict:
    if not LICHESS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LICHESS_API_KEY is not configured.",
        )

    query_params = {"fen": fen, "multiPv": multi_pv}
    if variant:
        query_params["variant"] = variant

    url = f"https://lichess.org/api/cloud-eval?{parse.urlencode(query_params)}"
    req = request.Request(
        url=url,
        method="GET",
        headers={
            "Authorization": f"Bearer {LICHESS_API_KEY}",
            "Accept": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=15) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)
    except error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        detail = response_body or exc.reason
        if exc.code == 404:
            raise HTTPException(status_code=404, detail=detail) from exc
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach Lichess cloud eval: {exc.reason}",
        ) from exc
