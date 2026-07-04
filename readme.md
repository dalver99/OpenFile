# cccron — chess puzzle pipeline

A database-driven pipeline that turns your Chess.com losses into tactics
puzzles and delivers them over Telegram. Puzzles are Lichess-style forced
sequences (every solver move is the only good move; the opponent defends best).

## Pipeline

The whole flow is a state machine on `player_games.status`, so each stage is an
independent, resumable job (and maps cleanly onto a Lambda function later):

```
ingest -> select -> analyze -> generate -> send / solve
ingested   selected   analyzed    puzzled
```

| Stage      | Command              | What it does                                            |
|------------|----------------------|---------------------------------------------------------|
| ingest     | `chesspipe ingest`   | Sync recent Chess.com games as `ingested`.              |
| select     | `chesspipe select`   | Claim one `ingested` loss → `selected` (swappable policy). |
| analyze    | `chesspipe analyze`  | Run Stockfish on one `selected` game → `analyzed`.      |
| generate   | `chesspipe generate` | Cook one `analyzed` game into a puzzle → `puzzled`/`no_puzzle`. |
| send       | `chesspipe send`     | Push the daily quota to linked Telegram users.          |
| bot        | `chesspipe bot`      | Interactive `/puzzle` bot; records solves.              |
| (all once) | `chesspipe run`      | ingest → select → analyze → generate, one item each.    |
| preview    | `chesspipe preview`  | Render puzzles to a local HTML gallery.                 |

Stages claim work with `SELECT ... FOR UPDATE SKIP LOCKED` and flip the row to a
transient state (`analyzing`/`generating`) before the long engine call, so
concurrent workers never collide or hold a lock across analysis.

## Engine: local or remote

One interface, two backends, switched by `ENGINE_MODE`:

- `local` — a local Stockfish UCI binary (`STOCKFISH_PATH`).
- `remote` — the FastAPI service in [`engine_server/`](engine_server/), via
  `ENGINE_API_URL` + `ENGINE_API_KEY`.

Both support per-position analysis (needed to cook puzzles) and whole-game
analysis, so switching is purely configuration.

## Setup

```bash
python3 -m venv venv && . venv/bin/activate
pip install -e .            # installs chesspipe + the `chesspipe` command
cp .env.example .env        # then edit DATABASE_URL etc.
```

Apply the schema. Fresh database — run `sql/001_schema.sql`. Existing legacy
database — run `sql/migrate_legacy.sql` instead (preserves games and Stockfish
analyses, rebuilds only the puzzle layer). Both set `search_path` to the app
schema, so you can paste them into a SQL console:

```bash
psql "$DATABASE_URL" -f sql/001_schema.sql        # fresh install
# or
psql "$DATABASE_URL" -f sql/migrate_legacy.sql    # upgrade existing data
```

The schema references `public.users(user_id, chessdotcom_id, deleted)`. Link a
user by ensuring that row exists with a populated `chessdotcom_id`, then point
`TARGET_USER_ID` at it. For Telegram delivery, insert a `telegram_users` row.

## Run

```bash
chesspipe run                         # one full pass
chesspipe analyze                     # or drive stages individually
chesspipe preview --limit-games 20    # local HTML gallery, no DB writes
```

Example cron (daily at 03:15):

```cron
15 3 * * * cd /path/to/cccron && . venv/bin/activate && chesspipe run >> /var/log/cccron.log 2>&1
```

## Remote engine (engine_server)

```bash
cd engine_server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export STOCKFISH_PATH=/absolute/path/to/stockfish
uvicorn app:app --host 0.0.0.0 --port 8000
```

Then set `ENGINE_MODE=remote`, `ENGINE_API_URL`, and `ENGINE_API_KEY` in `.env`.
See [`engine_server/README.md`](engine_server/README.md) for endpoints.
