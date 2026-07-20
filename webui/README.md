# OpenFile web UI

The Next.js interface reads the same personal SQLite database and configuration
created by the Python CLI.

```bash
# from the repository root, first run
openfile setup
openfile doctor

cd webui
npm install
npm run dev
```

Node.js 22.13 or newer is required because OpenFile uses the built-in
`node:sqlite` module—there is no native npm database dependency to compile.

The server reads the platform config automatically. `OPENFILE_CONFIG`,
`CHESSPIPE_ROOT`, and `CHESSPIPE_PYTHON` are available as development
overrides; see `.env.example` and `../docs/SETTINGS.md`.

For a hosted instance, set `NEXT_PUBLIC_SITE_URL` to its public origin so Open
Graph and Twitter image URLs do not point to localhost.

## Boundaries

- `app/` owns routes.
- `features/` owns page-level interactions.
- `components/` contains reusable board and theme UI.
- `domain/` contains serializable contracts.
- `server/database/` owns local config and SQLite lifecycle.
- `server/repositories/` owns all UI-facing SQL.
- `i18n/` contains user-facing language catalogs.

The Lichess token is optional. When absent, `/api/games/[id]/book` reports that
book enrichment is unavailable and the review continues without book labels.
