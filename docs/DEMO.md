# Hosted demo

The `vercel` branch is a lightweight showcase of OpenFile. It uses a committed,
sanitized snapshot rather than a database, local configuration, Python, or a
Stockfish process.

## Deploy to Vercel

1. Import the repository and select the `vercel` branch.
2. Set **Root Directory** to `webui`.
3. Keep the detected framework as **Next.js** and deploy.

This branch is always in demo mode. To preview it locally:

```bash
cd webui
npm run dev
```

No database URL, Chess.com credential, Lichess token, or Stockfish path belongs
in the Vercel project.

## Capability map

| Area | Local OpenFile source | Hosted demo behavior |
| --- | --- | --- |
| Games, reviews, graphs, comments | SQLite repositories | Read from `server/demo/fixtures.generated.json` |
| Search and filters | Repository queries | Apply the same filters to the in-memory snapshot |
| Review board, arrows, notation, retries | Browser components | Fully interactive |
| Analysis board and position editor | Browser + local Stockfish | Board, editor, PGN/FEN, and variations work; evaluation is disabled |
| Puzzle training | SQLite puzzle + solution APIs | One real sample puzzle is playable; progress is session-only |
| Sync | Chess.com ingest worker | Returns an explicitly labeled sample result |
| Game analysis | Python + Stockfish worker | Selection UI works; completion is simulated and no review is created |
| Favorites, collections, sidelines | SQLite mutations | Client-session interactions; reset on refresh or redeploy |
| Import, puzzle generation, automation | Local Python/native services | Clearly disabled with a local-app explanation |
| Opening enrichment | Optional Lichess explorer | Uses classifications already saved in the snapshot |

The boundary lives in `webui/server/data/`. Pages and safe APIs import that
facade instead of importing SQLite repositories directly. This keeps main-branch
changes easy to merge: update a repository contract once, then update its demo
adapter and fixture schema together.

## Refresh the snapshot

The exporter selects eight public Chess.com games from the configured player's
archive: four reviewed games and four waiting games. It also includes one puzzle
and aggregate insights. It deliberately excludes PGN, raw API responses, local
paths, configuration, database identifiers unrelated to the selected records,
and secrets.

From the repository root:

```bash
./.venv/bin/python tools/export_demo_data.py \
  --database "$HOME/Library/Application Support/OpenFile/openfile.db"
```

Use `--database` with the platform-appropriate local database path. Review the
result before committing:

```bash
git diff -- webui/server/demo/fixtures.generated.json
rg -n 'api[_-]?key|token|password|raw_json|database_path|pgn' \
  webui/server/demo/fixtures.generated.json
```

If the selected source IDs change, update `REVIEWED_IDS`, `WAITING_IDS`, and the
curated collection memberships near the top of `tools/export_demo_data.py`.

## Fixture contract

`schemaVersion` must change when an incompatible fixture shape is introduced.
The current payload contains:

- public game-card metadata and four complete move-analysis records;
- eight lightweight review shells so waiting-game pages still render;
- three curated demo collections;
- aggregate insight data derived from the local archive;
- one public puzzle card and its server-only answer record.

The answer is bundled only into a server module and is never sent by the puzzle
list page. `/api/attempt` discloses it only after a correct move or an explicit
reveal, matching the local application.
