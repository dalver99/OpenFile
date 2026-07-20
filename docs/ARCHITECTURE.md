# Architecture

OpenFile is a local-first modular monolith. The browser UI, Python pipeline,
SQLite database, and Stockfish process run on the same computer.

```text
Chess.com public API               optional Lichess explorer
          |                                  |
          v                                  v
   Python pipeline  <---- shared SQLite ---- Next.js server ---- browser
          |
          v
   local Stockfish UCI
```

This shape keeps installation understandable on macOS and Windows, avoids
accounts and cloud infrastructure, and gives contributors explicit boundaries.

## Active layout

```text
chesspipe/
  setup.py                 setup, discovery, doctor, config manager
  automation.py            native schedules, due rules, routine lock/status
  paths.py                 platform config/data locations
  config.py                JSON config + environment overrides
  stages.py                resumable ingest/analyze/generate workflow
  storage/
    schema.sql             idempotent SQLite schema
    sqlite.py              connection, WAL, initialization
  engine/
    base.py                engine protocol
    factory.py             local adapter construction
    local.py               Stockfish UCI adapter
  ingest/                  Chess.com client and persistence
  analyze/                 analysis persistence
  puzzle/                  puzzle generation and themes

webui/
  app/                     Next.js routes
  components/              reusable UI
  domain/                  browser-safe contracts
  features/                games, review, analysis, puzzles
  i18n/                    language catalogs
  server/
    database/              shared config reader and node:sqlite adapter
    repositories/          SQLite queries
    runtime/               local Python worker launcher

```

## Configuration and privacy

The Python CLI and Next.js server resolve the same platform-specific
`config.json` and SQLite path. Environment variables override those values for
development. Setup validates Stockfish with the UCI handshake before saving.

SQLite uses WAL mode and a 30-second busy timeout so the web server can read
while a Python analysis worker writes. Pipeline rows transition through stored
statuses, making interrupted jobs inspectable and recoverable.

User-owned features such as `favorite_games`, `review_sidelines`, and
`puzzle_progress` use `(user_id, resource_id)` ownership rather than global
flags. This keeps the local single-user experience simple while preserving the
schema boundary needed for future multi-user deployments.

The Lichess token is optional. Without it, the book endpoint returns
`available: false`; review, analysis, syncing, and puzzles remain functional.

Automation installs only a per-user native trigger. The trigger runs a wrapper
from the private OpenFile data directory every 30 minutes; `automation.py`
applies the selected due rule and calls the same `stages.py` functions as the
CLI. The web server is not part of scheduled execution. Run state and a local
lock make the behavior observable and prevent overlapping scheduled routines.

## Contributor rules

- Browser features must not read files or SQLite directly.
- Server repositories own SQL and return domain contracts.
- Chess features depend on the engine protocol, not subprocess details.
- Schema changes must remain idempotent for existing local databases.
- New user-facing strings belong in `webui/i18n/messages.ts`.
- Personal databases, tokens, paths, and generated analysis never belong in Git.

## Future adapters

SQLite and local Stockfish are the supported experience. A hosted database or
remote engine can return later only as an optional adapter with contract tests;
feature code and browser components should not branch on the backend.
