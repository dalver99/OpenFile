#!/usr/bin/env bash
# Analyze/generate a batch of recent rapid games, showing move count + a rough
# time estimate before each analyze call so long games don't feel "stuck".
#
# Usage:
#   ANALYSIS_DEPTH=21 COOK_DEPTH=21 N=5 ./scripts/rapid_batch.sh
#
# Env vars (all optional):
#   N              number of games to process (default 5)
#   TARGET_USER_ID player id to select games for (default 1)
#   SEC_PER_PLY    calibration constant for the ETA estimate (default 7.5,
#                  measured at ANALYSIS_DEPTH=21; adjust if you change depth)
#   MAX_PLIES      skip (and requeue) games longer than this many plies, since
#                  long/messy middlegames can take way longer than the linear
#                  ETA estimate suggests (default 90 = ~45 full moves)

set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate

# chesspipe prints timestamped "[... UTC] ..." log lines to stdout *before*
# its JSON result, so raw stdout isn't valid JSON on its own. Strip everything
# before the first '{' so jq only ever sees the JSON payload.
json_only() {
  awk '/^\{/{f=1} f'
}

N="${N:-5}"
TARGET_USER_ID="${TARGET_USER_ID:-1}"
SEC_PER_PLY="${SEC_PER_PLY:-7.5}"
MAX_PLIES="${MAX_PLIES:-90}"

puzzled=0
no_puzzle=0
failed=0

# Finish any leftover analyzed-but-not-generated game from a prior interrupted run.
leftover_gen=$(chesspipe generate | json_only) || true
leftover_status=$(echo "$leftover_gen" | jq -r '.status // "idle"')
if [ "$leftover_status" != "idle" ]; then
  echo "=== resuming leftover analyzed game ==="
  if [ "$leftover_status" = "ok" ]; then
    tag=$(echo "$leftover_gen" | jq -r '.tag')
    echo "generate -> puzzle created (theme: $tag) -- solution hidden"
    puzzled=$((puzzled + 1))
  elif [ "$leftover_status" = "no_puzzle" ]; then
    echo "generate -> no clean puzzle found in this game"
    no_puzzle=$((no_puzzle + 1))
  else
    echo "generate -> failed: $(echo "$leftover_gen" | jq -r '.error // "unknown error"')"
    failed=$((failed + 1))
  fi
  echo ""
fi

fmt_secs() {
  local s=$1
  if [ "$s" -ge 60 ]; then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%ds' "$s"
  fi
}

for i in $(seq 1 "$N"); do
  echo ""
  echo "=== [$i/$N] ==="

  sel=$(.venv/bin/python -c "
from dotenv import load_dotenv
load_dotenv()
import os, json, io, psycopg, chess.pgn
max_plies = int(os.environ.get('MAX_PLIES', '90'))
conn = psycopg.connect(os.environ['DATABASE_URL'])
skipped = []
chosen = None
tried_ids = []
with conn.cursor() as cur:
    cur.execute('SET search_path TO user_chess_analysis, public')
    for _ in range(20):
        cur.execute('''
            UPDATE player_games
            SET status = 'selected', status_updated_at = now()
            WHERE id = (
                SELECT pg.id
                FROM player_games pg
                JOIN chesscom_games g ON g.id = pg.game_id
                WHERE pg.player_id = %s
                  AND pg.status = 'ingested'
                  AND g.rules = 'chess'
                  AND g.time_class = 'rapid'
                  AND g.pgn IS NOT NULL AND g.pgn <> ''
                  AND NOT (pg.id = ANY(%s))
                ORDER BY g.end_time DESC
                FOR UPDATE OF pg SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, game_id
        ''', (os.environ.get('TARGET_USER_ID', '1'), tried_ids))
        row = cur.fetchone()
        if not row:
            break
        tried_ids.append(row[0])
        cur.execute('SELECT pgn FROM chesscom_games WHERE id = %s', (row[1],))
        pgn = cur.fetchone()[0]
        game = chess.pgn.read_game(io.StringIO(pgn))
        plies = sum(1 for _ in game.mainline_moves()) if game else 0
        if plies <= max_plies:
            chosen = {'player_game_id': row[0], 'game_id': row[1], 'plies': plies}
            conn.commit()
            break
        # too long for this batch: requeue it untouched and try the next candidate
        cur.execute(\"UPDATE player_games SET status = 'ingested' WHERE id = %s\", (row[0],))
        conn.commit()
        skipped.append({'player_game_id': row[0], 'game_id': row[1], 'plies': plies})
conn.close()
print(json.dumps({'chosen': chosen, 'skipped': skipped}))
")
  for row in $(echo "$sel" | jq -c '.skipped[]'); do
    spg=$(echo "$row" | jq -r '.player_game_id')
    sgame=$(echo "$row" | jq -r '.game_id')
    splies=$(echo "$row" | jq -r '.plies')
    echo "select   -> skipping rapid game $sgame (player_game $spg), $((splies / 2)) moves ($splies plies) > MAX_PLIES=$MAX_PLIES, left as ingested"
  done
  pg=$(echo "$sel" | jq -r '.chosen.player_game_id // empty')
  game=$(echo "$sel" | jq -r '.chosen.game_id // empty')
  plies=$(echo "$sel" | jq -r '.chosen.plies // 0')
  if [ -z "$pg" ]; then
    echo "select   -> no more recent rapid games left (within MAX_PLIES=$MAX_PLIES), stopping."
    break
  fi
  full_moves=$((plies / 2))
  eta=$(awk -v p="$plies" -v r="$SEC_PER_PLY" 'BEGIN{printf "%d", p*r}')
  echo "select   -> rapid game $game (player_game $pg), $full_moves moves ($plies plies), est. analyze time: $(fmt_secs "$eta")"

  t0=$(date +%s)
  an=$(chesspipe analyze | json_only) || true
  an_status=$(echo "$an" | jq -r '.status')
  echo "analyze  -> $an_status ($(fmt_secs $(( $(date +%s) - t0 ))))"
  if [ "$an_status" != "ok" ]; then
    echo "           $(echo "$an" | jq -r '.error // .reason // "unknown error"')"
    failed=$((failed + 1))
    continue
  fi

  gen=$(chesspipe generate | json_only) || true
  gstatus=$(echo "$gen" | jq -r '.status')
  if [ "$gstatus" = "ok" ]; then
    tag=$(echo "$gen" | jq -r '.tag')
    echo "generate -> puzzle created (theme: $tag) -- solution hidden"
    puzzled=$((puzzled + 1))
  elif [ "$gstatus" = "no_puzzle" ]; then
    echo "generate -> no clean puzzle found in this game"
    no_puzzle=$((no_puzzle + 1))
  else
    echo "generate -> failed: $(echo "$gen" | jq -r '.error // "unknown error"')"
    failed=$((failed + 1))
  fi
done

echo ""
echo "=== summary: $puzzled puzzled, $no_puzzle no_puzzle, $failed failed ==="
