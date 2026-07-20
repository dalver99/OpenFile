# Automation

OpenFile automation runs the existing local pipeline on a friendly schedule.
It does not require the web page to remain open, and it does not upload the
database, Stockfish output, or configuration anywhere.

## Routines

The Automation page offers three bounded routines:

| Routine | Work performed |
|---|---|
| Sync only | Fetch recent Chess.com games. |
| Prepare reviews | Sync, select up to the chosen game count, and analyze those games. |
| Prepare puzzles | Sync, prepare reviews, then attempt the chosen number of puzzle generations. |

The review and puzzle counts are per run. Idle stages stop naturally when
there is no eligible work, so selecting five games does not manufacture work
when only one new game exists.

## Schedules and power behavior

Choose every 6 hours, every 12 hours, daily at a preferred hour, or weekly on a
preferred day and hour. A lightweight native trigger checks every 30 minutes;
OpenFile itself decides whether the selected routine is due.

- The OpenFile web page and development server may be closed.
- The computer must be awake and the installing user must be signed in.
- A missed daily or weekly run is eligible after the next wake or sign-in.
- Interval schedules use the last attempt time, preventing rapid retry loops.
- An atomic local lock prevents two scheduled routines from overlapping.
- A stale lock older than six hours is recovered automatically.

Native per-user providers:

| Platform | Preferred provider | Fallback |
|---|---|---|
| macOS | LaunchAgent (`launchd`) | — |
| Linux | `systemd --user` timer | User crontab |
| Windows | Task Scheduler | — |

No administrator or root schedule is created.

## Web UI

Open **Schedule** in the main navigation. Pick a routine and schedule, adjust
the small per-run limits, and choose **Turn on automation**. The status panel
shows whether the native provider is installed, the next expected run, the
last result, and the local log path. **Run now** tests the saved routine without
waiting for its next scheduled time.

## CLI

```bash
# Inspect the current state
openfile automation status

# A light daily sync at 09:00 local time
openfile automation enable --preset sync --frequency daily --hour 9

# Prepare up to three reviews every 12 hours
openfile automation enable \
  --preset review \
  --frequency every_12_hours \
  --analyze-count 3

# Full weekly preparation: Monday at 08:00
openfile automation enable \
  --preset puzzles \
  --frequency weekly \
  --weekday 0 \
  --hour 8 \
  --analyze-count 3 \
  --puzzle-count 3

openfile automation run
openfile automation disable
```

Weekdays use `0` for Monday through `6` for Sunday. Times use the computer's
local time zone.

## Personal files

Schedule configuration, run state, the generated wrapper, and logs live in the
platform OpenFile data directory under `automation/`. They are personal runtime
files and are ignored if a data-directory override points into the repository.
The scheduled command contains only local paths; secrets such as the optional
Lichess token remain in the normal private configuration file.

Messaging and Telegram delivery are intentionally not part of this first
automation feature. A future delivery adapter can consume the routine summary
without changing the scheduler or pipeline stages.
