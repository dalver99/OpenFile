# Stockfish FastAPI Server

Small FastAPI server that queries a local Stockfish binary.

## 1) Setup

```bash
cd /home/poiso/projects/sfserver
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

By default, the app runs `stockfish` from `PATH`.

If your binary is elsewhere:

```bash
export STOCKFISH_PATH="/absolute/path/to/stockfish"
```

Optional: Stockfish UCI `Threads` (default `1`). Set higher to use more CPU on each search, e.g. `STOCKFISH_THREADS=8` in `.env`.

## 2) Run

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

## 3) Endpoints

All endpoints require:

```http
X-Stockfish-Api-Key: <your-api-key>
```

- `GET /health`
- `GET /cloud-eval`
- `POST /best-move`
- `POST /analyze`
- `POST /analyze-multipv`
- `POST /analyze-stream`
- `POST /analyze-game`

Interactive docs:

- <http://127.0.0.1:8000/docs>

## 4) Examples

Best move from starting position:

```bash
curl -X POST "http://127.0.0.1:8000/best-move" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"movetime_ms": 100}'
```

Best move after e2e4 e7e5:

```bash
curl -X POST "http://127.0.0.1:8000/best-move" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"moves":["e2e4","e7e5"],"movetime_ms":150}'
```

Analyze a position:

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"fen":"r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 2 3","depth":14}'
```

Fetch cached cloud eval from Lichess:

```bash
curl -G "http://127.0.0.1:8000/cloud-eval" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  --data-urlencode "fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" \
  --data-urlencode "multiPv=3"
```

Top candidate moves with MultiPV:

```bash
curl -X POST "http://127.0.0.1:8000/analyze-multipv" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"moves":["e2e4","e7e5"],"depth":12,"p":3}'
```

Incremental analysis updates as depth increases:

```bash
curl -N -X POST "http://127.0.0.1:8000/analyze-stream" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"moves":["e2e4","e7e5"],"max_depth":21,"p":3}'
```

`/analyze-stream` returns Server-Sent Events. A typical update looks like:

```text
event: depth_update
data: {"type":"depth_update","depth":12,"p":3,"lines":[{"rank":1,"score":"+0.35","score_cp":35,"best_move":"g1f3","depth":12,"nodes":123456,"pv":["g1f3","b8c6"]}]}
```

Analyze a full game from UCI moves:

```bash
curl -X POST "http://127.0.0.1:8000/analyze-game" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"moves":["e2e4","e7e5","g1f3","b8c6"],"depth":16,"p":1,"deep_depth":20,"deep_p":3,"deep_threshold_cp":60,"deep_max_moves":12}'
```

Analyze a full game from PGN:

```bash
curl -X POST "http://127.0.0.1:8000/analyze-game" \
  -H "Content-Type: application/json" \
  -H "X-Stockfish-Api-Key: $STOCKFISH_API_KEY" \
  -d '{"pgn":"1. e4 e5 2. Nf3 Nc6 *","depth":16,"p":1,"deep_depth":20,"deep_p":3,"deep_threshold_cp":60,"deep_max_moves":12}'
```

Whole-game analysis searches each main-line position once and reuses adjacent
position scores. Moves exceeding `deep_threshold_cp` are selectively searched
again at `deep_depth`, capped by `deep_max_moves`.

`/analyze-game` classifies each move with practical heuristics:

- `best`: played Stockfish's top move and lost <= 10 centipawns.
- `excellent`: played one of the top `p` moves and lost <= 25 centipawns.
- `great`: lost <= 25 centipawns and improved the evaluation by > 75 centipawns.
- `good`: lost <= 25 centipawns.
- `inaccuracy`: lost 26-70 centipawns.
- `mistake`: lost 71-180 centipawns.
- `blunder`: lost > 180 centipawns.
- `brilliant`: strong move from a clearly worse position to at least equal.

## 5) Project Structure

```text
app.py                 # FastAPI app assembly and Stockfish lifecycle
config.py              # .env loading and settings
schemas.py             # Pydantic request models
state.py               # Shared EngineManager instance
services/
  stockfish.py         # Stockfish engine logic and shared formatting/classification
routes/
  health.py            # GET /health
  best_move.py         # POST /best-move
  analysis.py          # POST /analyze and /analyze-multipv
  stream_analysis.py   # POST /analyze-stream
  game_analysis.py     # POST /analyze-game
```
