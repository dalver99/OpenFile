# Settings reference

Run `openfile setup` for the normal installation. Run `openfile config list`,
`get`, or `set` for advanced tuning. Personal values live in the platform's
application config directory and are never meant to be committed.

| Platform | Personal config | SQLite database |
|---|---|---|
| macOS | `~/Library/Application Support/OpenFile/config.json` | `~/Library/Application Support/OpenFile/openfile.db` |
| Windows | `%APPDATA%\OpenFile\config.json` | `%LOCALAPPDATA%\OpenFile\openfile.db` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/openfile/config.json` | `${XDG_DATA_HOME:-~/.local/share}/openfile/openfile.db` |

Existing Rookline paths are detected automatically and remain in place. New
environment overrides use `OPENFILE_CONFIG`, `OPENFILE_CONFIG_DIR`,
`OPENFILE_DATA_DIR`, and `OPENFILE_DATABASE_PATH`; the former `ROOKLINE_*`
names remain accepted as compatibility aliases.

Environment variables override config values for one process. Use
`OPENFILE_CONFIG`, `OPENFILE_CONFIG_DIR`, or `OPENFILE_DATA_DIR` for portable
and development installations.

## Identity and integrations

| Config key | Environment | Default | Meaning |
|---|---|---:|---|
| `chesscom_username` | — | required | Chess.com account whose games are synchronized. |
| `stockfish_path` | `STOCKFISH_PATH` | auto-detected | Absolute Stockfish executable path. |
| `lichess_api_key` | `LICHESS_API_KEY` | empty | Optional token for opening names and book-move labels. |
| `language` | `OPENFILE_LANGUAGE` | `en` | Interface language: `en` or `ko`. |
| `database_path` | `OPENFILE_DATABASE_PATH` | platform data directory | Personal SQLite database. |

## Game analysis

| Config key | Environment | Default | Meaning |
|---|---|---:|---|
| `analysis_depth` | `ANALYSIS_DEPTH` | 16 | Fast first-pass depth for every position. |
| `analysis_multipv` | `ANALYSIS_MULTIPV` | 1 | Candidate lines in the first pass. |
| `analysis_deep_depth` | `ANALYSIS_DEEP_DEPTH` | 20 | Selective critical-move depth. |
| `analysis_deep_multipv` | `ANALYSIS_DEEP_MULTIPV` | 3 | Candidate lines for critical moves. |
| `analysis_deep_threshold_cp` | `ANALYSIS_DEEP_THRESHOLD_CP` | 60 | Loss required for selective deepening. |
| `analysis_deep_max_moves` | `ANALYSIS_DEEP_MAX_MOVES` | 12 | Maximum deeply revisited moves per game. |
| `stockfish_threads` | `STOCKFISH_THREADS` | 1 | CPU threads per engine search. |
| `stockfish_hash_mb` | `STOCKFISH_HASH_MB` | 128 | Stockfish hash size in MB. |

### OpenFile Brilliant

The `Brilliant` label is deliberately narrower than a generic best move. The
first pass cheaply identifies moves that offer at least one pawn of material.
Only those candidates are selectively checked at the configured deep depth
with at least two candidate lines. A move receives `!!` when it:

- is Stockfish's first choice and loses no more than 15 centipawns;
- leaves the mover no worse than `-1.00`;
- did not begin from an already trivial advantage above `+5.00`;
- offers at least one pawn of material; and
- outperforms the second choice by at least 75 centipawns.

Forced moves are excluded. Up to three possible brilliancies reserve slots
inside `analysis_deep_max_moves`; they do not create an unbounded second pass.
Reanalyzing a game refreshes its stored move labels and candidate lines.
Use **Refresh analysis** in Game Review, or run:

```bash
openfile analyze --player-game-id 123 --force
```

## Puzzle generation and synchronization

| Config key | Environment | Default | Meaning |
|---|---|---:|---|
| `cook_depth` | `COOK_DEPTH` | 19 | Puzzle validation depth. |
| `cook_time_sec` | `COOK_TIME_SEC` | 3 | Per-position puzzle search ceiling. |
| `puzzle_max_candidates` | `PUZZLE_MAX_CANDIDATES` | 6 | Candidate mistakes attempted per game. |
| `puzzle_max_solution_plies` | `PUZZLE_MAX_SOLUTION_PLIES` | 11 | Maximum forced-line length. |
| `puzzle_fallback_min_plies` | `PUZZLE_FALLBACK_MIN_PLIES` | 0 | Minimum line length for the optional relaxed fallback; `0` disables it. |
| `recent_archive_months` | `RECENT_ARCHIVE_MONTHS` | 1 | Recent Chess.com monthly archives fetched. |
| `max_sync_games` | `MAX_SYNC_GAMES` | 100 | Most recent games considered per sync. |

These are defaults, not hard-coded archive limits. The Games page exposes them
under **Sync options** for each run; selecting **Refresh existing games** is the
web equivalent of `openfile ingest --force`.

Examples:

```bash
openfile config get stockfish_path
openfile config set stockfish_threads 2
openfile config set lichess_api_key lip_example
openfile config set lichess_api_key ""
```

Secrets are masked by `config list` and `config get`; neither command prints
the Lichess token.
