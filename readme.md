# OpenFile

OpenFile is a private, local-first Chess.com review and puzzle trainer. Your
games, favorites, sidelines, and Stockfish analysis stay in SQLite on your own
computer.

## Requirements

- Python 3.10 or newer (3.12 recommended)
- Node.js 22.13 or newer
- Stockfish 16 or newer
- A Chess.com username

On macOS, install Stockfish with `brew install stockfish`. On Windows, extract a
current build from the official Stockfish website; setup can usually find it.

## Guided installation

Each OpenFile command prints what to run next. Start in the repository root.

### 1. Select Python and create the environment

If you use pyenv:

```bash
pyenv install -s 3.12.1
pyenv local 3.12.1
python --version
python -m venv .venv
```

Without pyenv, first confirm `python3 --version` reports 3.10 or newer, then:

```bash
python3 -m venv .venv
```

Next, activate it:

```bash
# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
# .venv\Scripts\Activate.ps1
```

Your prompt should now include `(.venv)`. Continue with step 2.

### 2. Install OpenFile

```bash
python -m pip install --upgrade pip
python -m pip install -e .
```

Next, run `openfile setup`.

### 3. Configure the local services

```bash
openfile setup
```

Setup walks through Chess.com, Stockfish, the optional Lichess token, and the
personal SQLite database. It ends by telling you to run:

```bash
openfile doctor
```

### 4. Verify and launch

When every doctor check is green, it prints these next steps:

```bash
cd webui
npm install
npm run dev
```

Open <http://localhost:3000>, then click **Sync games**. `npm install` is only
needed on the first launch or after web dependencies change. Keep the terminal
running while using OpenFile; press `Ctrl+C` to stop it.

Open **Schedule** in the main navigation when you want OpenFile to sync,
prepare reviews, or prepare puzzles automatically. The web page may be closed
after the native user schedule is installed; the computer must remain awake
and signed in when work runs.

## Daily use

Usually, start the web UI and use its Games page. The equivalent CLI workflow is:

```bash
openfile ingest
openfile select --limit 3
openfile analyze
openfile generate
```

The Games page can also import one of the configured player's Chess.com links,
start its review immediately, and file it in a collection. The CLI equivalent
is:

```bash
openfile import-game --url https://www.chess.com/game/live/123456789
```

Use **Collections** for opening studies, tournaments, or model games. The Games
page groups detailed Chess.com opening names into parent families for filtering,
and the Analysis page includes a position editor with piece placement, side to
move, castling rights, and en-passant state.

Manage or inspect configuration with:

```bash
openfile doctor
openfile config list
openfile config set analysis_depth 14
openfile config set language ko
openfile config path
```

See [Settings](docs/SETTINGS.md) for every parameter, [Commands](PIPELINE_COMMANDS.md)
for batch workflows, [Automation](docs/AUTOMATION.md) for scheduled routines,
and [Architecture](docs/ARCHITECTURE.md) for contributor
boundaries.

## Privacy and compatibility

OpenFile contacts Chess.com's public API and, when configured, Lichess's opening
explorer. SQLite, engine analysis, configuration, and tokens remain local.

The former `rookline` command and Rookline application-data directory remain
supported as compatibility aliases, so upgrading does not hide or replace an
existing database.

## License

AGPL-3.0-only. Improvements remain available to the community.
