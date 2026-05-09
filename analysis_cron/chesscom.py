from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any

import requests


BASE_URL = "https://api.chess.com/pub"
LOSS_RESULTS = {
    "checkmated",
    "timeout",
    "resigned",
    "lose",
    "abandoned",
    "kingofthehill",
    "threecheck",
    "bughousepartnerlose",
}


@dataclass(frozen=True)
class ChessComGame:
    url: str
    pgn: str
    end_time: int | None
    time_class: str | None
    time_control: str | None
    rules: str
    player_color: str
    player_result: str
    opponent_username: str
    white: dict[str, Any]
    black: dict[str, Any]
    raw: dict[str, Any]


class ChessComClient:
    def __init__(self, user_agent: str) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Origin": "https://www.chess.com",
                "Referer": "https://www.chess.com/",
                "User-Agent": user_agent,
            }
        )

    def _get_json(self, url: str) -> dict[str, Any]:
        response = self.session.get(url, timeout=30)
        if response.status_code == 403 and "just a moment" in response.text.lower():
            # Cloudflare sometimes allows browser-like follow-up requests.
            response = self.session.get(url, timeout=30)
        if response.status_code == 429:
            time.sleep(10)
            response = self.session.get(url, timeout=30)
        response.raise_for_status()
        return response.json()

    def archive_urls(self, username: str) -> list[str]:
        payload = self._get_json(f"{BASE_URL}/player/{username.lower()}/games/archives")
        return payload.get("archives", [])

    def recent_games(self, username: str, archive_months: int) -> list[ChessComGame]:
        archives = self.archive_urls(username)
        selected_archives = archives[-archive_months:] if archive_months > 0 else archives

        games: list[ChessComGame] = []
        for archive_url in selected_archives:
            payload = self._get_json(archive_url)
            for raw_game in payload.get("games", []):
                parsed = self._parse_game(username, raw_game)
                if parsed is not None:
                    games.append(parsed)

        return sorted(games, key=lambda game: game.end_time or 0, reverse=True)

    def lost_games(self, username: str, archive_months: int) -> list[ChessComGame]:
        return [
            game
            for game in self.recent_games(username, archive_months)
            if game.rules == "chess" and game.player_result in LOSS_RESULTS and game.pgn
        ]

    def choose_random_lost_game(
        self,
        username: str,
        archive_months: int,
        excluded_urls: set[str] | None = None,
    ) -> ChessComGame | None:
        excluded_urls = excluded_urls or set()
        candidates = [
            game
            for game in self.lost_games(username, archive_months)
            if game.url not in excluded_urls
        ]
        if not candidates:
            return None
        return random.choice(candidates)

    def _parse_game(self, username: str, raw_game: dict[str, Any]) -> ChessComGame | None:
        white = raw_game.get("white") or {}
        black = raw_game.get("black") or {}
        username_lower = username.lower()
        white_username = str(white.get("username", "")).lower()
        black_username = str(black.get("username", "")).lower()

        if white_username == username_lower:
            player_color = "white"
            player = white
            opponent = black
        elif black_username == username_lower:
            player_color = "black"
            player = black
            opponent = white
        else:
            return None

        return ChessComGame(
            url=raw_game["url"],
            pgn=raw_game.get("pgn", ""),
            end_time=raw_game.get("end_time"),
            time_class=raw_game.get("time_class"),
            time_control=raw_game.get("time_control"),
            rules=raw_game.get("rules", ""),
            player_color=player_color,
            player_result=player.get("result", ""),
            opponent_username=opponent.get("username", ""),
            white=white,
            black=black,
            raw=raw_game,
        )

