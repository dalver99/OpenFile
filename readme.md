# cccron — chess puzzle pipeline

A database-driven pipeline that turns your Chess.com games into tactics
puzzles and delivers them over Telegram. Puzzles are Lichess-style forced
sequences (every solver move is the only good move; the opponent defends best).

The codebase is organized as a modular monolith with replaceable engine and
storage adapters. See [Architecture](docs/ARCHITECTURE.md) for the folder map,
dependency boundaries, and the recommended PostgreSQL/SQLite roadmap.

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
| select     | `chesspipe select`   | Claim one `ingested` game → `selected` (swappable policy). |
| analyze    | `chesspipe analyze`  | Run Stockfish on one `selected` game → `analyzed`.      |
| generate   | `chesspipe generate` | Cook one `analyzed` game into a puzzle → `puzzled`/`no_puzzle`. |
| send       | `chesspipe send`     | Push the daily quota to linked Telegram users.          |
| bot        | `chesspipe bot`      | Interactive `/puzzle` bot; records solves.              |
| (all once) | `chesspipe run`      | ingest → select → analyze → generate, one item each.    |
| preview    | `chesspipe preview`  | Render puzzles to a local HTML gallery.                 |

Stages claim work with `SELECT ... FOR UPDATE SKIP LOCKED` and flip the row to a
transient state (`analyzing`/`generating`) before the long engine call, so
concurrent workers never collide or hold a lock across analysis.

Normal ingest fetches the configured recent Chess.com archive window, checks
the candidate URLs in one database query, and writes only new games. Use
`chesspipe ingest --force` only when existing recent game metadata must be
refreshed as well.

## Engine: local or remote

One interface, two backends, switched by `ENGINE_MODE`:

- `local` — a local Stockfish UCI binary (`STOCKFISH_PATH`).
- `remote` — the FastAPI service in [`engine_server/`](engine_server/), via
  `ENGINE_API_URL` + `ENGINE_API_KEY`.

Both support per-position analysis (needed to cook puzzles) and whole-game
analysis, so switching is purely configuration.

`STOCKFISH_PATH=stockfish` uses the executable from `PATH`; set an absolute
path when Stockfish is installed elsewhere or the process runs from cron.

Whole-game review uses an adaptive two-pass search:

- Every main-line position is analyzed once at `ANALYSIS_DEPTH` /
  `ANALYSIS_MULTIPV`. The next position's score is reused as the previous
  move's after-score, avoiding duplicate adjacent-position searches.
- Moves losing at least `ANALYSIS_DEEP_THRESHOLD_CP` are revisited at
  `ANALYSIS_DEEP_DEPTH` / `ANALYSIS_DEEP_MULTIPV`, capped by
  `ANALYSIS_DEEP_MAX_MOVES`.

The recommended local defaults are depth 16 and MultiPV 1 for the fast pass,
then depth 20 and MultiPV 3 for at most 12 critical moves.

Puzzle cooking is separately bounded because it follows hypothetical engine
lines rather than the recorded game. The default cooker:

- validates at depth 19 with a three-second per-position ceiling;
- prioritizes the largest stored evaluation swings;
- attempts at most six candidate positions per game;
- stops hypothetical lines after eleven plies; and
- reuses exact position analyses within the game.

The default quality profile requires a forced line of at least three plies and
does not accept a one-move fallback. Set `PUZZLE_FALLBACK_MIN_PLIES=1` only if
higher puzzle yield is more important than filtering out one-move tactics and
mate-in-one.

These limits are controlled by `COOK_DEPTH`, `COOK_TIME_SEC`,
`PUZZLE_MAX_CANDIDATES`, `PUZZLE_MAX_SOLUTION_PLIES`, and
`PUZZLE_FALLBACK_MIN_PLIES`.

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
chesspipe generate --retry-no-puzzle  # retry one old miss with current rules
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
