from __future__ import annotations

from io import BytesIO
from typing import Any

from telegram import InputFile, Update
from telegram.ext import ContextTypes

from analysis_cron.bot.render import (
    build_puzzle_caption,
    build_solution_san,
    parse_answer_to_uci,
    render_board_png,
)
from analysis_cron.bot.repositories import (
    get_latest_pending_delivery,
    get_telegram_user,
    increment_delivery_attempt,
    insert_delivery,
    mark_delivery_revealed,
    mark_delivery_solved,
    pick_undelivered_puzzle,
)
from analysis_cron.config import Settings
from analysis_cron.db import get_connection

ALLOWED_PHASES = {"opening", "middlegame", "endgame"}


def _chat_id(update: Update) -> int | None:
    if update.effective_chat is None:
        return None
    return update.effective_chat.id


def _read_phase_arg(context: ContextTypes.DEFAULT_TYPE) -> str | None:
    if not context.args:
        return None
    value = context.args[0].strip().lower()
    if value in ALLOWED_PHASES:
        return value
    return None


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None:
        return
    settings: Settings = context.application.bot_data["settings"]
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
    if not tg_user:
        await update.message.reply_text(
            "You are not linked yet. Ask admin to insert your telegram_id into user_chess_analysis.telegram_users."
        )
        return
    await update.message.reply_text("Linked. Use /puzzle or /puzzle opening|middlegame|endgame.")


async def whoami_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None:
        return
    settings: Settings = context.application.bot_data["settings"]
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
    if not tg_user:
        await update.message.reply_text("No linked user found for this chat.")
        return
    await update.message.reply_text(
        f"telegram_user_id={tg_user['id']}, app_user_id={tg_user['user_id']}, daily_quota={tg_user['daily_quota']}"
    )


async def puzzle_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None:
        return
    phase = _read_phase_arg(context)
    if context.args and phase is None:
        await update.message.reply_text("Phase must be one of: opening, middlegame, endgame.")
        return

    settings: Settings = context.application.bot_data["settings"]
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
        if not tg_user:
            await update.message.reply_text(
                "You are not linked yet. Ask admin to insert your telegram_id into user_chess_analysis.telegram_users."
            )
            return

        puzzle = pick_undelivered_puzzle(
            conn,
            app_user_id=int(tg_user["user_id"]),
            telegram_user_id=int(tg_user["id"]),
            phase=phase,
        )
        if not puzzle:
            await update.message.reply_text("No more puzzles available for this filter.")
            return

        image_bytes = render_board_png(
            fen=str(puzzle["fen_before"]),
            last_move_uci=None,
            perspective=str(puzzle["side_to_move"]),
        )
        bio = BytesIO(image_bytes)
        bio.name = "puzzle.png"
        sent = await update.message.reply_photo(
            photo=InputFile(bio),
            caption=build_puzzle_caption(puzzle),
        )
        insert_delivery(
            conn,
            puzzle_id=int(puzzle["id"]),
            telegram_user_id=int(tg_user["id"]),
            chat_message_id=sent.message_id,
        )
        conn.commit()


async def answer_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None or not update.message.text:
        return

    # Ignore slash commands; command handlers already process those.
    if update.message.text.startswith("/"):
        return

    settings: Settings = context.application.bot_data["settings"]
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
        if not tg_user:
            return

        pending = get_latest_pending_delivery(conn, int(tg_user["id"]))
        if not pending:
            await update.message.reply_text("No active puzzle. Use /puzzle first.")
            return

        answer_uci = parse_answer_to_uci(str(pending["fen_before"]), update.message.text)
        if answer_uci is None:
            await update.message.reply_text("Could not parse that move. Try SAN (Nf3) or UCI (g1f3).")
            return

        solution_uci = str(pending["solution_uci"])
        if answer_uci == solution_uci:
            mark_delivery_solved(conn, int(pending["delivery_id"]))
            conn.commit()
            solution_san = pending.get("solution_san") or build_solution_san(
                str(pending["fen_before"]), solution_uci
            )
            await update.message.reply_text(f"Correct. Best move: {solution_san or solution_uci}")
            return

        attempts = increment_delivery_attempt(conn, int(pending["delivery_id"]))
        if attempts >= 2:
            mark_delivery_revealed(conn, int(pending["delivery_id"]))
            conn.commit()
            solution_san = pending.get("solution_san") or build_solution_san(
                str(pending["fen_before"]), solution_uci
            )
            await update.message.reply_text(
                f"Not quite. Puzzle closed.\nBest move: {solution_san or solution_uci}"
            )
            return

        conn.commit()
        await update.message.reply_text("Not correct yet. Try one more time.")


async def give_up_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None:
        return
    settings: Settings = context.application.bot_data["settings"]
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
        if not tg_user:
            await update.message.reply_text("No linked user found for this chat.")
            return
        pending = get_latest_pending_delivery(conn, int(tg_user["id"]))
        if not pending:
            await update.message.reply_text("No active puzzle to reveal.")
            return
        mark_delivery_revealed(conn, int(pending["delivery_id"]))
        conn.commit()
        solution_uci = str(pending["solution_uci"])
        solution_san = pending.get("solution_san") or build_solution_san(
            str(pending["fen_before"]), solution_uci
        )
        await update.message.reply_text(f"Revealed: {solution_san or solution_uci}")

