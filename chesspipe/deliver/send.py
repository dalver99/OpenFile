"""Daily push: send each linked user up to their remaining quota of puzzles."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Any

from telegram import Bot, InputFile

from chesspipe.config import Settings
from chesspipe.db import get_connection
from chesspipe.deliver.render import build_puzzle_caption, render_board_png
from chesspipe.deliver.repository import (
    count_sent_on_date,
    list_active_telegram_users,
    pick_undelivered_puzzles,
    record_sent,
)


async def send_daily_puzzles(settings: Settings) -> dict[str, Any]:
    if not settings.telegram_bot_token:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN in environment.")

    tz = settings.delivery_timezone
    tz_name = str(tz.key)
    today = datetime.now(tz).date().isoformat()
    outcomes: list[dict[str, Any]] = []
    bot = Bot(token=settings.telegram_bot_token)

    async with bot:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            for user in list_active_telegram_users(conn):
                app_user_id = int(user["user_id"])
                telegram_id = int(user["telegram_id"])
                quota = int(user.get("daily_quota") or settings.telegram_default_daily_quota)

                sent_today = count_sent_on_date(conn, app_user_id, today, tz_name)
                remaining = max(0, quota - sent_today)
                row: dict[str, Any] = {
                    "app_user_id": app_user_id,
                    "telegram_id": telegram_id,
                    "daily_quota": quota,
                    "already_sent_today": sent_today,
                    "sent_now": 0,
                }
                if remaining == 0:
                    row["status"] = "quota_reached"
                    outcomes.append(row)
                    continue

                puzzles = pick_undelivered_puzzles(conn, user_id=app_user_id, limit_n=remaining)
                if not puzzles:
                    row["status"] = "no_puzzles"
                    outcomes.append(row)
                    continue

                try:
                    for puzzle in puzzles:
                        image = render_board_png(
                            fen=str(puzzle["fen_before"]),
                            last_move_uci=None,
                            perspective=str(puzzle["side_to_move"]),
                        )
                        bio = BytesIO(image)
                        bio.name = "puzzle.png"
                        sent = await bot.send_photo(
                            chat_id=telegram_id,
                            photo=InputFile(bio),
                            caption=build_puzzle_caption(puzzle),
                        )
                        record_sent(
                            conn,
                            puzzle_id=int(puzzle["id"]),
                            user_id=app_user_id,
                            telegram_message_id=sent.message_id,
                        )
                    conn.commit()
                    row["status"] = "sent"
                    row["sent_now"] = len(puzzles)
                except Exception as exc:  # noqa: BLE001
                    conn.rollback()
                    row["status"] = "error"
                    row["error"] = str(exc)
                outcomes.append(row)

    return {"status": "ok", "date": today, "timezone": tz_name, "users": outcomes}
