"""Tests for incremental Chess.com archive synchronization."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chesspipe.ingest.repository as repository
from chesspipe.ingest.chesscom import ChessComGame


class FakeCursor:
    def __init__(self, known_urls: set[str]) -> None:
        self.known_urls = known_urls
        self.urls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, _query: str, params) -> None:
        self.urls = list(params[1])

    def fetchall(self):
        return [(url,) for url in self.urls if url in self.known_urls]


class FakeConnection:
    def __init__(self, known_urls: set[str]) -> None:
        self.known_urls = known_urls

    def cursor(self):
        return FakeCursor(self.known_urls)


class FakeClient:
    def __init__(self, games: list[ChessComGame]) -> None:
        self.games = games

    def recent_games(self, _username: str, _archive_months: int):
        return self.games


def game(number: int) -> ChessComGame:
    return ChessComGame(
        url=f"https://chess.com/game/{number}",
        pgn="*",
        end_time=number,
        time_class="rapid",
        time_control="600",
        rules="chess",
        white={"username": "player", "result": "win"},
        black={"username": "opponent", "result": "resigned"},
        raw={},
    )


def run_sync(refresh_existing: bool) -> tuple[repository.SyncSummary, list[str]]:
    games = [game(3), game(2), game(1)]
    written: list[str] = []
    original = repository.upsert_game_and_player
    repository.upsert_game_and_player = (
        lambda _conn, _player_id, _username, item: written.append(item.url) or 1
    )
    try:
        summary = repository.sync_recent_games(
            FakeConnection({games[1].url, games[2].url}),  # type: ignore[arg-type]
            FakeClient(games),  # type: ignore[arg-type]
            1,
            "player",
            archive_months=1,
            max_sync_games=40,
            refresh_existing=refresh_existing,
            log=lambda _message: None,
        )
    finally:
        repository.upsert_game_and_player = original
    return summary, written


def test_normal_sync_writes_only_unseen_urls():
    summary, written = run_sync(refresh_existing=False)
    assert summary == {"fetched": 3, "upserted": 1}
    assert written == ["https://chess.com/game/3"]


def test_force_sync_refreshes_the_candidate_window():
    summary, written = run_sync(refresh_existing=True)
    assert summary == {"fetched": 3, "upserted": 3}
    assert len(written) == 3


def _run_all() -> int:
    tests = [
        value
        for key, value in sorted(globals().items())
        if key.startswith("test_") and callable(value)
    ]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
