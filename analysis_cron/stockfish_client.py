from typing import Any

import requests


class StockfishClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "X-Stockfish-Api-Key": api_key,
            }
        )

    def health(self) -> dict[str, Any]:
        response = self.session.get(f"{self.base_url}/health", timeout=10)
        response.raise_for_status()
        return response.json()

    def analyze_game(self, pgn: str, depth: int, multipv: int) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/analyze-game",
            json={"pgn": pgn, "depth": depth, "p": multipv},
            timeout=600,
        )
        response.raise_for_status()
        return response.json()
