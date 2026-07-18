# Architecture

cccron is a modular monolith: one repository and one data model, with a Python
pipeline, an optional engine HTTP service, and a Next.js UI. This is a better
open-source default than mandatory microservices because a single user can run
everything on one computer, while hosted deployments can move Stockfish onto a
separate machine without changing pipeline code.

## Runtime shape

```text
Chess.com / Lichess
        |
        v
Python pipeline ---- EngineClient ---- Local Stockfish
        |                  |
        |                  +---------- Remote engine_server
        v
PostgreSQL <-------- Next.js server -------- Browser UI
```

The important rule is dependency direction: chess features depend on engine
and storage interfaces; adapters contain operating-system, HTTP, and SQL
details. Browser components never import a database module.

## Repository layout

```text
chesspipe/                 Python application
  ingest/                  Chess.com import feature
  analyze/                 game-analysis feature and queries
  puzzle/                  puzzle generation and rendering
  deliver/                 Telegram delivery
  engine/
    base.py                EngineClient protocol
    factory.py             configured adapter selection
    local.py               local UCI Stockfish adapter
    remote.py              engine_server HTTP adapter
  storage/
    postgres.py            PostgreSQL connection adapter
  config.py                environment-backed application settings
  stages.py                resumable pipeline orchestration

engine_server/             optional remote Stockfish service
sql/                       PostgreSQL schema and migrations

webui/
  app/                     Next.js routes and route handlers only
  components/              reusable UI primitives
  domain/                  serializable data contracts shared with clients
  features/                analysis, games, puzzles, and review UI
  lib/                     browser-safe chess/review utilities
  server/
    database/              database drivers and pool lifecycle
    repositories/          server-side queries
    runtime/               local Python worker launcher
```

## Stockfish portability

`EngineClient` is the application port. `build_engine()` selects either:

- `ENGINE_MODE=local`: `LocalEngine` starts `STOCKFISH_PATH` as a UCI process.
- `ENGINE_MODE=remote`: `RemoteEngine` calls `engine_server`.

`STOCKFISH_PATH=stockfish` uses the executable found in the process `PATH`.
An absolute path is the most predictable choice for cron, containers, and the
web worker. No Stockfish binary should be committed to this repository; users
install an appropriate build for their OS and CPU.

New engines should implement `EngineClient` and be registered in
`engine/factory.py`. Feature code should not inspect the configured backend.

## Database portability

PostgreSQL is the only supported database today. This is explicit because the
current schema uses `jsonb`, schemas, timezone expressions, and
`FOR UPDATE SKIP LOCKED`. Merely accepting `DATABASE_ENGINE=sqlite` would not
make those semantics portable.

The recommended open-source progression is:

1. Keep PostgreSQL for hosted/multi-user deployments and concurrent workers.
2. Add SQLite as a separate local/single-user adapter.
3. Move feature queries behind repository interfaces and keep migrations per
   dialect (or adopt SQLAlchemy Core/Alembic for common schema operations).
4. Implement job claiming separately: PostgreSQL uses row locking; SQLite uses
   a short `BEGIN IMMEDIATE` transaction and a conditional status update.
5. Run the same repository contract tests against both adapters.

MySQL is not a useful first target: it adds another server dependency while
doing less for the local-user installation story than SQLite.

The Next.js repositories are already isolated under `webui/server/`. A future
backend should be selected once during server startup and exposed through the
same repository contract; React components should remain unchanged.

## Boundaries to preserve

- `domain/` contains data shapes, not SQL or React hooks.
- `features/` may import domain types and shared components, not server code.
- API routes and server pages may import repositories and runtime adapters.
- Pipeline stages coordinate work; feature repositories own their SQL.
- Secrets and machine-specific paths stay in `.env` files.
- Long analysis work stays resumable and idempotent through persisted status.

## Sensible next refactors

The present structure is clean enough to accept contributors. The next high
value changes are smaller extractions, not a rewrite:

- split `GameReview.tsx` into review board, notation, coach card, and sideline
  hooks;
- split `stages.py` into one application service per pipeline stage;
- add repository contract tests before implementing SQLite;
- replace the fixed `WEBUI_USER_ID` boundary with an authenticated user
  context when multi-user hosting begins.
