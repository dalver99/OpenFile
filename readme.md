## Daily Chess.com analysis (PostgreSQL + Stockfish)

The worker loads the target user from `public.users` (by `TARGET_USER_ID`, requiring a non-empty `chessdotcom_id`), syncs recent finished games from the Chess.com PubAPI into PostgreSQL, picks one random **unanalyzed loss** (standard chess), runs Stockfish analysis, and stores results in `game_analyses` and `move_analyses`.

Stockfish can run in one of two modes (see `STOCKFISH_MODE`):

- `api` — calls a remote Stockfish HTTP service `POST /analyze-game` (with `X-Stockfish-Api-Key`).
- `local` — drives a locally installed Stockfish binary over UCI via python-chess (`STOCKFISH_PATH`). No server or API key required.

Both modes produce the same stored analysis, so you can switch per environment (for example, `local` on your workstation and `api` in production).

Idempotency is enforced in the database:

- One `analysis_runs` row per `(run_date, player_id)` while a run is in progress or finished.
- At most one `game_analyses` row per `(game_id, player_id, stockfish_depth, stockfish_multipv, heuristic_version)`.

### Schema

Apply the migrations in order on database `cccron` as your app role (for example `cccron_app`):

1. [`sql/001_create_tables.sql`](sql/001_create_tables.sql) — game, analysis, and opening tables.
2. [`sql/002_create_puzzle_tables.sql`](sql/002_create_puzzle_tables.sql) — `puzzles`, `telegram_users`, and `puzzle_deliveries` (required for puzzle generation and the Telegram bot).

The schema references `public.users(user_id)` and reads `public.users.chessdotcom_id`. Link a user by ensuring that row exists with a populated `chessdotcom_id`.

### Environment

Copy [`.env.example`](.env.example) to `.env` and set at least `DATABASE_URL` and `STOCKFISH_API_KEY`.

`DATABASE_URL` must be a `postgresql://` URI (for example from Vercel storage). Special characters in passwords must be URL-encoded if you embed them in the URL string.

### Install

```bash
cd /path/to/cccron
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

### Run

```bash
. .venv/bin/activate
python scripts/run_daily_analysis.py
```

The target user is selected by `TARGET_USER_ID` and must exist in `public.users` with a populated `chessdotcom_id`.

To generate puzzles from analyzed games and run the Telegram bot:

```bash
python scripts/generate_puzzles.py     # build puzzles from move analyses
python scripts/send_daily_puzzles.py    # push the daily quota to linked Telegram users
python scripts/run_telegram_bot.py      # interactive /puzzle bot
```

### Using a local Stockfish binary

Set `STOCKFISH_MODE=local` and point `STOCKFISH_PATH` at your binary (defaults to `stockfish` on `PATH`). In this mode no HTTP service or `STOCKFISH_API_KEY` is required. Tune `STOCKFISH_THREADS` and `STOCKFISH_HASH_MB` to your hardware. Analysis depth is controlled by `STOCKFISH_DEPTH` (or the `--depth` flag).

### Cron

Example daily at 03:15 (server local time):

```cron
15 3 * * * cd /path/to/cccron && . .venv/bin/activate && python scripts/run_daily_analysis.py >> /var/log/cccron.log 2>&1
```

### Linking a user

Ensure the target user exists in `public.users` with a populated `chessdotcom_id`, then point `TARGET_USER_ID` at that `user_id`. For Telegram delivery, insert a matching row into `telegram_users` (`user_id` referencing `public.users`, plus the recipient's `telegram_id`).
