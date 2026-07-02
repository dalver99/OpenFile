#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from telegram import Bot, InputFile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from analysis_cron.bot.render import build_puzzle_caption, render_board_png  # noqa: E402
from analysis_cron.bot.repositories import (  # noqa: E402
    count_deliveries_on_date,
    insert_delivery,
    list_active_telegram_users,
    pick_undelivered_puzzles,
)
from analysis_cron.config import Settings  # noqa: E402
from analysis_cron.db import get_connection  # noqa: E402


async def run_send_daily_puzzles(settings: Settings) -> dict[str, Any]:
    if not settings.telegram_bot_token:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN in environment.")

    bot = Bot(token=settings.telegram_bot_token)
    kst_today = datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat()
    outcomes: list[dict[str, Any]] = []

    async with bot:
        with get_connection(settings.database_url, settings.db_schema) as conn:
            users = list_active_telegram_users(conn)
            for user in users:
                telegram_user_id = int(user["id"])
                app_user_id = int(user["user_id"])
                telegram_id = int(user["telegram_id"])
                daily_quota = int(user.get("daily_quota") or settings.telegram_default_daily_quota)

                sent_today = count_deliveries_on_date(conn, telegram_user_id, kst_today)
                remaining = max(0, daily_quota - sent_today)
                row: dict[str, Any] = {
                    "telegram_user_id": telegram_user_id,
                    "telegram_id": telegram_id,
                    "daily_quota": daily_quota,
                    "already_sent_today": sent_today,
                    "sent_now": 0,
                }
                if remaining == 0:
                    row["status"] = "quota_reached"
                    outcomes.append(row)
                    continue

                puzzles = pick_undelivered_puzzles(
                    conn,
                    app_user_id=app_user_id,
                    telegram_user_id=telegram_user_id,
                    limit_n=remaining,
                )
                if not puzzles:
                    row["status"] = "no_puzzles"
                    outcomes.append(row)
                    continue

                try:
                    for puzzle in puzzles:
                        image_bytes = render_board_png(
                            fen=str(puzzle["fen_before"]),
                            last_move_uci=None,
                            perspective=str(puzzle["side_to_move"]),
                        )
                        bio = BytesIO(image_bytes)
                        bio.name = "puzzle.png"
                        sent = await bot.send_photo(
                            chat_id=telegram_id,
                            photo=InputFile(bio),
                            caption=build_puzzle_caption(puzzle),
                        )
                        insert_delivery(
                            conn,
                            puzzle_id=int(puzzle["id"]),
                            telegram_user_id=telegram_user_id,
                            chat_message_id=sent.message_id,
                        )
                    conn.commit()
                    row["status"] = "sent"
                    row["sent_now"] = len(puzzles)
                except Exception as exc:
                    conn.rollback()
                    row["status"] = "error"
                    row["error"] = str(exc)
                outcomes.append(row)

    return {"status": "ok", "kst_date": kst_today, "users": outcomes}


def main() -> int:
    result = asyncio.run(run_send_daily_puzzles(Settings.from_env()))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

