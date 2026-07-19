# OpenFile command reference

Run these commands from the project directory after activating the virtual
environment. On Windows PowerShell, replace `source .venv/bin/activate` with
`.venv\Scripts\Activate.ps1`.

## First-time setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
openfile setup
openfile doctor
```

`openfile setup` asks for a Chess.com username, discovers Stockfish when it can,
and creates the local SQLite database. The Lichess token prompt is optional;
press Enter to run without opening-book enrichment.

## Sync recent games

```bash
openfile ingest
```

Use `openfile ingest --force` only when recent games already in SQLite should be
refreshed.

The Games page is the easiest way to run this interactively: it shows each
archive-fetch phase, games checked/added/already local, cancellation and retry,
and links to the exact games added by the run. Sync history is stored in SQLite,
so the last result remains visible after a browser or server restart.

For a wider one-off command-line sync:

```bash
openfile ingest --months 3 --max-games 500
```

## Analyze a batch

Select games first, then run one analysis process per selected game:

```bash
openfile select --limit 3

for _ in {1..3}; do
  openfile analyze
done
```

PowerShell equivalent:

```powershell
openfile select --limit 3
1..3 | ForEach-Object { openfile analyze }
```

## Generate puzzles

Each invocation examines one analyzed game. A game can legitimately produce no
puzzle when none of its mistakes passes the quality checks.

```bash
for _ in {1..3}; do
  openfile generate
done
```

To reconsider older `no_puzzle` results with the current settings:

```bash
openfile generate --retry-no-puzzle
```

## Run one complete cycle

```bash
openfile run
```

For batches, use the separated commands so Chess.com is not synchronized before
every individual analysis.

## Web UI

```bash
cd webui
npm install
npm run dev
```

Open <http://localhost:3000>. The Games page can also start sync and analysis
processes on this computer.

## Tune or diagnose

```bash
openfile doctor
openfile config list
openfile config get analysis_depth
openfile config set analysis_depth 14
openfile config path
```

See [`docs/SETTINGS.md`](docs/SETTINGS.md) for every managed parameter.
## Schedule local routines

Use the web **Schedule** page for the easiest setup, or manage the same native
user schedule from the CLI:

```bash
openfile automation status
openfile automation enable --preset puzzles --frequency daily --hour 9 --analyze-count 2 --puzzle-count 2
openfile automation run
openfile automation disable
```

See `docs/AUTOMATION.md` for platform providers and power/sleep behavior.
