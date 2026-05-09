## Daily Chess.com analysis (PostgreSQL + Stockfish API)

The worker loads active rows from `chesscom_players`, syncs recent finished games from the Chess.com PubAPI into PostgreSQL, picks one random **unanalyzed loss** (standard chess), calls your Stockfish service `POST /analyze-game` (with `X-Stockfish-Api-Key`), and stores results in `game_analyses` and `move_analyses`.

Idempotency is enforced in the database:

- One `analysis_runs` row per `(run_date, player_id)` while a run is in progress or finished.
- At most one `game_analyses` row per `(game_id, player_id, stockfish_depth, stockfish_multipv, heuristic_version)`.

### Schema

Apply [`sql/001_create_tables.sql`](sql/001_create_tables.sql) on database `cccron` as your app role (for example `cccron_app`).

Optional column `chesscom_players.app_user_id` links a Chess.com row to your main app user id without cross-database joins.

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

If the `chesscom_players` table is empty, set `CHESSCOM_USERNAME` once to bootstrap a single active player.

### Cron

Example daily at 03:15 (server local time):

```cron
15 3 * * * cd /path/to/cccron && . .venv/bin/activate && python scripts/run_daily_analysis.py >> /var/log/cccron.log 2>&1
```

### Linking to another application database

Prefer storing your main app’s user id in `chesscom_players.app_user_id` and syncing that value from your primary app (API job, queue, or shared service). Do not grant `cccron_app` direct read access to user tables in a separate database unless you intentionally want cross-database coupling and operational risk.
