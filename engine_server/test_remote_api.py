import json
import os
from urllib import request

from dotenv import load_dotenv


load_dotenv()

BASE_URL = os.getenv("STOCKFISH_API_URL", "http://3.34.125.155:8000").rstrip("/")
API_KEY = os.getenv("STOCKFISH_API_KEY")


def call_api(method: str, path: str, payload: dict | None = None) -> dict:
    headers = {"Accept": "application/json"}
    body = None

    if API_KEY:
        headers["X-Stockfish-Api-Key"] = API_KEY

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(
        f"{BASE_URL}{path}",
        data=body,
        headers=headers,
        method=method,
    )

    with request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    if not API_KEY:
        print("Warning: STOCKFISH_API_KEY is not set; sending request without API key.")

    print("Health:")
    print(json.dumps(call_api("GET", "/health"), indent=2))

    print("\nBest move:")
    print(json.dumps(call_api("POST", "/best-move", {"movetime_ms": 100}), indent=2))
