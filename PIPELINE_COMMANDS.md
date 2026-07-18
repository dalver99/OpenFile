# Chess Pipeline Commands

Run these commands from `/Users/kevinkim/cccron`.

## Sync recent games

```bash
./.venv/bin/python -m chesspipe.cli ingest --force
```

## Analyze three games

Select three games, then analyze them one at a time:

```bash
./.venv/bin/python -m chesspipe.cli select --limit 3

for _ in {1..3}; do
  ./.venv/bin/python -m chesspipe.cli analyze
done
```

## Generate puzzles from three analyzed games

```bash
for _ in {1..3}; do
  ./.venv/bin/python -m chesspipe.cli generate
done
```

Not every analyzed game contains a suitable puzzle, so run more iterations if
some games finish with `no_puzzle`.

## Retry older `no_puzzle` games

```bash
for _ in {1..3}; do
  ./.venv/bin/python -m chesspipe.cli generate --retry-no-puzzle
done
```

## Run one complete cycle

This performs one sync, selection, analysis, and puzzle-generation cycle:

```bash
./.venv/bin/python -m chesspipe.cli run
```

For batches, prefer the separated commands above so Chess.com is not synced
again before every analysis.
