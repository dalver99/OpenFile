"""Interactive Telegram bot: serve puzzles and record solve state.

A thin client over the database. All solve state lives in ``puzzle_progress``
via :mod:`chesspipe.deliver.repository`, so the bot and a future web UI stay in
sync.
"""

from __future__ import annotations

from io import BytesIO

from telegram import InputFile, Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from chesspipe.config import Settings
from chesspipe.storage import get_connection
from chesspipe.deliver.render import (
    build_puzzle_caption,
    build_solution_san,
    parse_answer_to_uci,
    render_board_png,
)
from chesspipe.deliver.repository import (
    get_latest_pending,
    get_telegram_user,
    increment_attempt,
    mark_revealed,
    mark_solved,
    pick_undelivered_puzzle,
    record_sent,
)

ALLOWED_PHASES = {"opening", "middlegame", "endgame"}
_NOT_LINKED = (
    "You are not linked yet. Ask the admin to add your telegram_id to telegram_users."
)


def _chat_id(update: Update) -> int | None:
    return update.effective_chat.id if update.effective_chat else None


def _read_phase_arg(context: ContextTypes.DEFAULT_TYPE) -> str | None:
    if not context.args:
        return None
    value = context.args[0].strip().lower()
    return value if value in ALLOWED_PHASES else None


def _settings(context: ContextTypes.DEFAULT_TYPE) -> Settings:
    return context.application.bot_data["settings"]


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None:
        return
    with get_connection(_settings(context).database_url, _settings(context).db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
    if not tg_user:
        await update.message.reply_text(_NOT_LINKED)
        return
    await update.message.reply_text("Linked. Use /puzzle or /puzzle opening|middlegame|endgame.")


async def whoami_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None:
        return
    with get_connection(_settings(context).database_url, _settings(context).db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
    if not tg_user:
        await update.message.reply_text("No linked user found for this chat.")
        return
    await update.message.reply_text(
        f"telegram_user_id={tg_user['id']}, app_user_id={tg_user['user_id']}, "
        f"daily_quota={tg_user['daily_quota']}"
    )


async def puzzle_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None:
        return
    phase = _read_phase_arg(context)
    if context.args and phase is None:
        await update.message.reply_text("Phase must be one of: opening, middlegame, endgame.")
        return

    settings = _settings(context)
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
        if not tg_user:
            await update.message.reply_text(_NOT_LINKED)
            return

        app_user_id = int(tg_user["user_id"])
        puzzle = pick_undelivered_puzzle(conn, user_id=app_user_id, phase=phase)
        if not puzzle:
            await update.message.reply_text("No more puzzles available for this filter.")
            return

        image = render_board_png(
            fen=str(puzzle["fen_before"]),
            last_move_uci=None,
            perspective=str(puzzle["side_to_move"]),
        )
        bio = BytesIO(image)
        bio.name = "puzzle.png"
        sent = await update.message.reply_photo(
            photo=InputFile(bio), caption=build_puzzle_caption(puzzle)
        )
        record_sent(
            conn,
            puzzle_id=int(puzzle["id"]),
            user_id=app_user_id,
            telegram_message_id=sent.message_id,
        )
        conn.commit()


async def answer_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = _chat_id(update)
    if chat_id is None or update.message is None or not update.message.text:
        return
    if update.message.text.startswith("/"):
        return

    settings = _settings(context)
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
        if not tg_user:
            return

        pending = get_latest_pending(conn, int(tg_user["user_id"]))
        if not pending:
            await update.message.reply_text("No active puzzle. Use /puzzle first.")
            return

        answer_uci = parse_answer_to_uci(str(pending["fen_before"]), update.message.text)
        if answer_uci is None:
            await update.message.reply_text("Could not parse that move. Try SAN (Nf3) or UCI (g1f3).")
            return

        solution_uci = str(pending["solution_uci"])
        solution_san = pending.get("solution_san") or build_solution_san(
            str(pending["fen_before"]), solution_uci
        )

        if answer_uci == solution_uci:
            mark_solved(conn, int(pending["progress_id"]))
            conn.commit()
            await update.message.reply_text(f"Correct. Best move: {solution_san or solution_uci}")
            return

        attempts = increment_attempt(conn, int(pending["progress_id"]))
        if attempts >= 2:
            mark_revealed(conn, int(pending["progress_id"]))
            conn.commit()
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
    settings = _settings(context)
    with get_connection(settings.database_url, settings.db_schema) as conn:
        tg_user = get_telegram_user(conn, chat_id)
        if not tg_user:
            await update.message.reply_text("No linked user found for this chat.")
            return
        pending = get_latest_pending(conn, int(tg_user["user_id"]))
        if not pending:
            await update.message.reply_text("No active puzzle to reveal.")
            return
        mark_revealed(conn, int(pending["progress_id"]))
        conn.commit()
        solution_uci = str(pending["solution_uci"])
        solution_san = pending.get("solution_san") or build_solution_san(
            str(pending["fen_before"]), solution_uci
        )
        await update.message.reply_text(f"Revealed: {solution_san or solution_uci}")


def build_application(settings: Settings) -> Application:
    if not settings.telegram_bot_token:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN in environment.")
    app = Application.builder().token(settings.telegram_bot_token).build()
    app.bot_data["settings"] = settings
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("whoami", whoami_handler))
    app.add_handler(CommandHandler("puzzle", puzzle_handler))
    app.add_handler(CommandHandler("give_up", give_up_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, answer_handler))
    return app


def run_polling(settings: Settings) -> None:
    build_application(settings).run_polling()
