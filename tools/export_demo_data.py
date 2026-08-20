#!/usr/bin/env python3
"""Export a small, sanitized OpenFile demo snapshot from a local SQLite database.

The committed output intentionally excludes PGN, raw Chess.com responses, local paths,
configuration, API keys, and every table not required by the read-only demo.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REVIEWED_IDS = (207, 205, 62, 12)
WAITING_IDS = (206, 203, 88, 90)
DEMO_IDS = REVIEWED_IDS + WAITING_IDS
DRAW_RESULTS = {"agreed", "stalemate", "repetition", "insufficient", "50move", "timevsinsufficient"}
SEVERE = {"mistake", "blunder"}
COLLECTIONS = [
    {"id": 901, "name": "Turning points", "description": "Decisions worth replaying without an engine hint.", "color": "#7c3aed", "game_ids": [207, 205, 12]},
    {"id": 902, "name": "Brilliant finds", "description": "Verified best-move material sacrifices.", "color": "#0f766e", "game_ids": [62, 12]},
    {"id": 903, "name": "Opening notebook", "description": "A compact set of positions to revisit.", "color": "#a12222", "game_ids": [207, 206, 203]},
]


def row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def opening_name(url: str | None) -> str | None:
    if not url:
        return None
    slug = url.lower().split("/openings/", 1)[-1].split("?", 1)[0].split("#", 1)[0]
    words = [word for word in re.sub(r"[^a-z0-9-]+", "-", slug).strip("-").split("-") if word]
    names = {"queens": "Queen's", "kings": "King's"}
    label = " ".join(names.get(word, word.capitalize()) for word in words)
    return re.sub(r"^Caro Kann\b", "Caro-Kann", label) or None


def opening_family(url: str | None) -> tuple[str, str] | None:
    if not url:
        return None
    slug = url.lower().split("/openings/", 1)[-1]
    known = [
        ("caro-kann-defense", "Caro-Kann Defense"), ("sicilian-defense", "Sicilian Defense"),
        ("kings-indian-defense", "King's Indian Defense"), ("nimzo-indian-defense", "Nimzo-Indian Defense"),
        ("queens-gambit", "Queen's Gambit"), ("french-defense", "French Defense"),
        ("english-opening", "English Opening"), ("italian-game", "Italian Game"),
        ("giuoco-piano-game", "Italian Game"), ("scotch-game", "Scotch Game"),
        ("ruy-lopez", "Ruy Lopez"),
    ]
    for candidate, label in known:
        if candidate in slug:
            return ("italian-game" if candidate == "giuoco-piano-game" else candidate, label)
    words = [word for word in re.sub(r"[^a-z0-9-]+", "-", slug).strip("-").split("-") if word]
    markers = {"defense", "opening", "game", "gambit", "attack", "system"}
    boundary = next((index for index, word in enumerate(words) if word in markers), min(2, len(words) - 1))
    family_slug = "-".join(words[: boundary + 1])
    return family_slug, opening_name(family_slug) or "Unknown opening"


def clock_seconds(pgn: str) -> list[float | None]:
    values: list[float | None] = []
    for raw in re.findall(r"\[%clk\s+([^\]]+)\]", pgn):
        try:
            parts = [float(part) for part in raw.strip().split(":")]
            value = 0.0
            for part in parts:
                value = value * 60 + part
            values.append(round(value, 1))
        except ValueError:
            values.append(None)
    return values


def accuracy(losses: list[int]) -> int:
    if not losses:
        return 100
    average = sum(min(1000, max(0, loss)) for loss in losses) / len(losses)
    return max(1, round(100 * math.exp(-average / 250)))


def result_kind(result: str) -> str:
    if result == "win":
        return "win"
    return "draw" if result in DRAW_RESULTS else "loss"


def phase(move_number: int) -> str:
    return "Opening" if move_number <= 10 else "Middlegame" if move_number <= 30 else "Endgame"


def slice_value(label: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    losses = [min(1000, max(0, int(row.get("centipawn_loss") or 0))) for row in rows]
    return {
        "label": label,
        "games": len({row["player_game_id"] for row in rows}),
        "moves": len(rows),
        "accuracy": accuracy(losses),
        "averageLoss": round(sum(losses) / len(losses)) if losses else 0,
        "severeErrors": sum(row["classification"] in SEVERE for row in rows),
        "blunders": sum(row["classification"] == "blunder" for row in rows),
    }


def export(database: Path) -> dict[str, Any]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    user = connection.execute("SELECT user_id, chessdotcom_id FROM users WHERE deleted = 0 ORDER BY user_id LIMIT 1").fetchone()
    if user is None:
        raise RuntimeError("No active OpenFile user was found.")
    user_id = int(user["user_id"])

    placeholders = ",".join("?" for _ in DEMO_IDS)
    game_rows = connection.execute(
        f"""
        SELECT pg.id, g.chesscom_url, g.white_username, g.black_username,
               g.white_rating, g.black_rating, g.white_result, g.black_result,
               substr(g.end_time, 1, 10) AS played_at, g.time_class, g.time_control,
               pg.side, pg.result, pg.rating_after, pg.status, pg.status_detail,
               g.eco_url, g.pgn, ga.id AS analysis_id, ga.engine_id, ga.depth,
               substr(ga.created_at, 1, 16) AS analysis_created_at
        FROM player_games pg
        JOIN chesscom_games g ON g.id = pg.game_id
        LEFT JOIN game_analyses ga ON ga.player_game_id = pg.id
        WHERE pg.player_id = ? AND pg.id IN ({placeholders})
        """,
        (user_id, *DEMO_IDS),
    ).fetchall()
    rows_by_id = {int(row["id"]): row for row in game_rows}
    missing = [game_id for game_id in DEMO_IDS if game_id not in rows_by_id]
    if missing:
        raise RuntimeError(f"Demo source games are missing: {missing}")

    collection_ids: dict[int, list[int]] = defaultdict(list)
    for collection in COLLECTIONS:
        for game_id in collection["game_ids"]:
            collection_ids[game_id].append(collection["id"])

    games: list[dict[str, Any]] = []
    reviews: dict[str, Any] = {}
    for game_id in DEMO_IDS:
        row = rows_by_id[game_id]
        move_rows: list[sqlite3.Row] = []
        if row["analysis_id"] is not None:
            move_rows = connection.execute(
                """SELECT ply, move_number, side, move_uci, san, classification,
                          centipawn_loss, evaluation_before_cp, evaluation_after_cp,
                          evaluation_change_cp, played_rank, top_moves, fen_before, fen_after
                   FROM move_analyses WHERE game_analysis_id = ? ORDER BY ply""",
                (row["analysis_id"],),
            ).fetchall()
        user_losses = [int(move["centipawn_loss"] or 0) for move in move_rows if move["side"] == row["side"]]
        card = {
            "id": game_id,
            "white_username": row["white_username"], "black_username": row["black_username"],
            "white_rating": row["white_rating"], "black_rating": row["black_rating"],
            "white_result": row["white_result"], "black_result": row["black_result"],
            "played_at": row["played_at"], "time_class": row["time_class"], "time_control": row["time_control"],
            "side": row["side"], "result": row["result"], "rating_after": row["rating_after"],
            "status": "analyzed" if row["analysis_id"] is not None else "ingested",
            "status_detail": None,
            "opening": opening_name(row["eco_url"]),
            "opening_family": opening_family(row["eco_url"]),
            "analyzed": row["analysis_id"] is not None,
            "analysis_depth": row["depth"],
            "accuracy": accuracy(user_losses) if move_rows else None,
            "is_favorite": game_id in {207, 62},
            "collection_ids": collection_ids[game_id],
        }
        games.append(card)
        clocks = clock_seconds(row["pgn"] or "")
        moves = []
        for index, move in enumerate(move_rows):
            value = row_dict(move)
            value["top_moves"] = json_value(value["top_moves"], [])
            value["clock_seconds"] = clocks[index] if index < len(clocks) else None
            moves.append(value)
        reviews[str(game_id)] = {
            "game": {
                **{key: value for key, value in card.items() if key != "opening_family"},
                "chesscom_url": row["chesscom_url"],
                    # Engine identifiers may embed a local executable path; the demo
                    # needs no engine identity to render a completed review.
                    "engine_id": None,
                "analysis_created_at": row["analysis_created_at"],
            },
            "moves": moves,
            "sidelines": [],
        }

    all_move_rows = [row_dict(row) for row in connection.execute(
        """SELECT pg.id AS player_game_id, substr(g.end_time, 1, 10) AS played_at,
                  g.time_class, g.time_control, pg.side AS player_side, pg.result,
                  g.eco_url, g.pgn, ma.ply, ma.move_number, ma.san,
                  ma.classification, ma.centipawn_loss
           FROM game_analyses ga
           JOIN player_games pg ON pg.id = ga.player_game_id
           JOIN chesscom_games g ON g.id = pg.game_id
           JOIN move_analyses ma ON ma.game_analysis_id = ga.id AND ma.side = pg.side
           WHERE ga.player_id = ? ORDER BY g.end_time DESC, pg.id DESC, ma.ply""",
        (user_id,),
    ).fetchall()]
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in all_move_rows:
        grouped[int(row["player_game_id"])].append(row)

    phases = [slice_value(name, [row for row in all_move_rows if phase(int(row["move_number"])) == name]) for name in ("Opening", "Middlegame", "Endgame")]
    time_classes = [slice_value(name.capitalize(), [row for row in all_move_rows if row["time_class"] == name]) for name in sorted({str(row["time_class"]) for row in all_move_rows})]
    opening_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in all_move_rows:
        opening_groups[opening_name(row["eco_url"]) or "Unknown opening"].append(row)
    openings = []
    for label, rows in opening_groups.items():
        value = slice_value(label, rows)
        game_ids = {int(row["player_game_id"]) for row in rows}
        results = [result_kind(grouped[game_id][0]["result"]) for game_id in game_ids]
        points = sum(1 if result == "win" else 0.5 if result == "draw" else 0 for result in results)
        openings.append({**value, "winRate": round(100 * points / len(results)) if results else 0})
    openings.sort(key=lambda item: (-item["games"], -item["averageLoss"], item["label"]))

    recent_groups = list(grouped.items())[:12]
    trend = []
    for game_id, rows in reversed(recent_groups):
        first = rows[0]
        trend.append({
            "id": game_id if game_id in REVIEWED_IDS else REVIEWED_IDS[game_id % len(REVIEWED_IDS)],
            "playedAt": first["played_at"],
            "opponentLabel": opening_name(first["eco_url"]) or "Unknown opening",
            "accuracy": accuracy([int(row["centipawn_loss"] or 0) for row in rows]),
            "result": result_kind(first["result"]),
        })
    brilliancies = [
        {
            "gameId": int(row["player_game_id"]), "playedAt": row["played_at"],
            "moveNumber": int(row["move_number"]), "side": row["player_side"],
            "san": row["san"], "opening": opening_name(row["eco_url"]) or "Unknown opening",
        }
        for row in all_move_rows if row["classification"] == "brilliant" and int(row["player_game_id"]) in REVIEWED_IDS
    ][:12]
    weakest = max((item for item in phases if item["moves"] >= 5), key=lambda item: item["averageLoss"])
    focus_game = next((game_id for game_id, rows in grouped.items() if game_id in REVIEWED_IDS and any(phase(int(row["move_number"])) == weakest["label"] for row in rows)), REVIEWED_IDS[0])

    puzzle_row = connection.execute(
        """SELECT p.id, p.fen_before, p.last_move_uci, p.solution_uci, p.solution_san,
                  p.solution_line_uci, p.side_to_move, p.phase, p.tag, p.themes,
                  p.cp_loss, p.is_mate, p.mate_in, p.difficulty, p.quality_score,
                  p.time_class, p.opponent_username, substr(p.played_at, 1, 10) AS played_at,
                  pp.status AS progress_status, COALESCE(pp.attempts, 0) AS attempts
           FROM puzzles p LEFT JOIN puzzle_progress pp ON pp.puzzle_id = p.id AND pp.user_id = ?
           WHERE p.source_player_id = ? ORDER BY p.quality_score DESC, p.id LIMIT 1""",
        (user_id, user_id),
    ).fetchone()
    puzzles: list[dict[str, Any]] = []
    solutions: dict[str, Any] = {}
    if puzzle_row:
        raw = row_dict(puzzle_row)
        solution = {
            "solution_uci": raw.pop("solution_uci"),
            "solution_san": raw.pop("solution_san"),
            "solution_line_uci": json_value(raw.pop("solution_line_uci"), []),
        }
        raw["themes"] = json_value(raw["themes"], [])
        raw["is_mate"] = bool(raw["is_mate"])
        raw["progress_status"] = None
        raw["attempts"] = 0
        puzzles.append(raw)
        solutions[str(raw["id"])] = solution

    archive = connection.execute(
        """SELECT count(*) AS games,
                  sum(CASE WHEN g.pgn LIKE '%[%clk %' THEN 1 ELSE 0 END) AS with_clock
           FROM player_games pg JOIN chesscom_games g ON g.id = pg.game_id
           WHERE pg.player_id = ? AND g.rules = 'chess'""",
        (user_id,),
    ).fetchone()
    all_game_accuracies = [accuracy([int(row["centipawn_loss"] or 0) for row in rows]) for rows in grouped.values()]
    normal_losses = [min(1000, max(0, int(row["centipawn_loss"] or 0))) for row in all_move_rows]
    insights = {
        "reviewedGames": len(grouped), "totalMoves": len(all_move_rows),
        "averageAccuracy": round(sum(all_game_accuracies) / len(all_game_accuracies)) if all_game_accuracies else 0,
        "severeErrors": sum(row["classification"] in SEVERE for row in all_move_rows),
        "blunders": sum(row["classification"] == "blunder" for row in all_move_rows),
        "brilliantMoves": sum(row["classification"] == "brilliant" for row in all_move_rows),
        "brilliancies": brilliancies, "phase": phases, "timeClasses": time_classes,
        "openings": openings[:8], "trend": trend,
        "clock": {
            "archiveGames": int(archive["games"] or 0), "archiveGamesWithClock": int(archive["with_clock"] or 0),
            "reviewedGamesWithClock": len(grouped), "trackedMoves": len(all_move_rows),
            "timePressureMoves": 0, "severeErrors": sum(row["classification"] in SEVERE for row in all_move_rows),
            "timePressureSevereErrors": 0,
            "averageLossUnderPressure": None,
            "averageLossWithTime": round(sum(normal_losses) / len(normal_losses)) if normal_losses else None,
        },
        "focus": {
            "title": f"{weakest['label']} decisions are the clearest training target",
            "detail": f"Your {weakest['label'].lower()} moves average {weakest['averageLoss']} centipawns of loss across {weakest['moves']} reviewed decisions. Revisit the largest swings before adding new theory.",
            "href": f"/games/{focus_game}",
        },
    }
    connection.close()

    cards = [{key: value for key, value in game.items() if key != "opening_family"} for game in games]
    families: dict[str, dict[str, Any]] = {}
    for game in games:
        family = game["opening_family"]
        if family:
            slug, name = family
            families.setdefault(slug, {"slug": slug, "name": name, "count": 0})["count"] += 1
    collections = [
        {"id": item["id"], "name": item["name"], "description": item["description"],
         "color": item["color"], "game_count": len(item["game_ids"]), "updated_at": "2026-07-20 00:00:00"}
        for item in COLLECTIONS
    ]
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "profile": {"username": user["chessdotcom_id"], "label": "Sanitized personal archive snapshot"},
        "games": cards, "reviews": reviews, "collections": collections,
        "openingFamilies": sorted(families.values(), key=lambda item: (-item["count"], item["name"])),
        "insights": insights, "puzzles": puzzles, "puzzleSolutions": solutions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True, help="Path to the local OpenFile SQLite database")
    parser.add_argument("--output", type=Path, default=Path("webui/server/demo/fixtures.generated.json"))
    args = parser.parse_args()
    payload = export(args.database.expanduser().resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['games'])} games, {len(payload['reviews'])} reviews, and {len(payload['puzzles'])} puzzle to {args.output}")


if __name__ == "__main__":
    main()
