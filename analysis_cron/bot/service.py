from __future__ import annotations

from telegram.ext import Application, CommandHandler, MessageHandler, filters

from analysis_cron.bot.handlers import (
    answer_handler,
    give_up_handler,
    puzzle_handler,
    start_handler,
    whoami_handler,
)
from analysis_cron.config import Settings


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
    app = build_application(settings)
    app.run_polling()

