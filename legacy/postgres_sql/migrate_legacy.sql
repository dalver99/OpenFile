-- In-place migration from the legacy schema to the chesspipe schema.
-- Preserves games, openings, telegram linkage, and (importantly) the existing
-- Stockfish analyses. Only the puzzle layer and dead tables are dropped.
--
-- Runs inside a single transaction: if anything fails, nothing is applied.
-- HOW TO APPLY: paste this whole file into your SQL console and run it.
-- Fresh databases should use sql/001_schema.sql instead.

BEGIN;
SET search_path TO user_chess_analysis, public;

-- 1) Drop the regenerated puzzle layer and dead tables.
DROP TABLE IF EXISTS puzzle_deliveries CASCADE;
DROP TABLE IF EXISTS puzzles CASCADE;
DROP TABLE IF EXISTS analysis_runs CASCADE;
DROP TABLE IF EXISTS game_analysis_tags CASCADE;
DROP TABLE IF EXISTS tags CASCADE;

-- 2) player_games: add the pipeline state machine.
ALTER TABLE player_games
    ADD COLUMN IF NOT EXISTS is_loss BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ingested',
    ADD COLUMN IF NOT EXISTS status_detail TEXT,
    ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE player_games DROP COLUMN IF EXISTS opponent_player_id;

UPDATE player_games SET is_loss = (result IN (
    'checkmated', 'timeout', 'resigned', 'lose', 'abandoned',
    'kingofthehill', 'threecheck', 'bughousepartnerlose'
));

ALTER TABLE player_games DROP CONSTRAINT IF EXISTS player_games_status_check;
ALTER TABLE player_games ADD CONSTRAINT player_games_status_check
    CHECK (status IN (
        'ingested', 'selected', 'analyzing', 'analyzed',
        'generating', 'puzzled', 'no_puzzle', 'failed'
    ));

CREATE INDEX IF NOT EXISTS idx_player_games_status ON player_games (status, player_id);
CREATE INDEX IF NOT EXISTS idx_player_games_loss ON player_games (player_id, is_loss, status);

-- 3) game_analyses: reshape old columns into the new ones.
ALTER TABLE game_analyses
    ADD COLUMN IF NOT EXISTS player_game_id BIGINT,
    ADD COLUMN IF NOT EXISTS engine_id TEXT,
    ADD COLUMN IF NOT EXISTS depth INTEGER,
    ADD COLUMN IF NOT EXISTS multipv INTEGER;

UPDATE game_analyses SET
    engine_id = COALESCE(engine_id, stockfish_api_url, 'legacy'),
    depth     = COALESCE(depth, stockfish_depth),
    multipv   = COALESCE(multipv, stockfish_multipv);

UPDATE game_analyses ga SET player_game_id = pg.id
FROM player_games pg
WHERE pg.game_id = ga.game_id
  AND pg.player_id = ga.player_id
  AND ga.player_game_id IS NULL;

-- Drop any analysis that can't be linked to a player_games row (should be none).
DELETE FROM game_analyses WHERE player_game_id IS NULL;

ALTER TABLE game_analyses
    ALTER COLUMN player_game_id SET NOT NULL,
    ALTER COLUMN engine_id SET NOT NULL,
    ALTER COLUMN depth SET NOT NULL,
    ALTER COLUMN multipv SET NOT NULL;

ALTER TABLE game_analyses DROP CONSTRAINT IF EXISTS game_analyses_player_game_id_key;
ALTER TABLE game_analyses ADD CONSTRAINT game_analyses_player_game_id_key UNIQUE (player_game_id);
ALTER TABLE game_analyses DROP CONSTRAINT IF EXISTS game_analyses_player_game_id_fkey;
ALTER TABLE game_analyses ADD CONSTRAINT game_analyses_player_game_id_fkey
    FOREIGN KEY (player_game_id) REFERENCES player_games(id) ON DELETE CASCADE;

ALTER TABLE game_analyses
    DROP COLUMN IF EXISTS stockfish_depth CASCADE,
    DROP COLUMN IF EXISTS stockfish_multipv CASCADE,
    DROP COLUMN IF EXISTS stockfish_api_url,
    DROP COLUMN IF EXISTS server_schema_version,
    DROP COLUMN IF EXISTS heuristic_version;

CREATE INDEX IF NOT EXISTS idx_game_analyses_player_created ON game_analyses (player_id, created_at DESC);

-- 4) move_analyses is already compatible (a leftover created_at column is harmless).

-- 5) Recreate the puzzle + solve layer fresh.
CREATE TABLE puzzles (
    id BIGSERIAL PRIMARY KEY,
    game_analysis_id BIGINT NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    source_player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    mistake_ply INTEGER NOT NULL,
    fen_before TEXT NOT NULL,
    last_move_uci TEXT,
    solution_uci TEXT NOT NULL,
    solution_san TEXT,
    solution_line_uci JSONB NOT NULL DEFAULT '[]'::jsonb,
    side_to_move TEXT NOT NULL CHECK (side_to_move IN ('white', 'black')),
    phase TEXT,
    tag TEXT,
    themes JSONB NOT NULL DEFAULT '[]'::jsonb,
    cp_loss INTEGER,
    is_mate BOOLEAN NOT NULL DEFAULT FALSE,
    mate_in INTEGER,
    difficulty INTEGER,
    quality_score INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_analysis_id, mistake_ply)
);
CREATE INDEX idx_puzzles_player_quality ON puzzles (source_player_id, quality_score DESC);
CREATE INDEX idx_puzzles_phase ON puzzles (phase);

CREATE TABLE puzzle_progress (
    id BIGSERIAL PRIMARY KEY,
    puzzle_id BIGINT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'solved', 'revealed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'telegram',
    telegram_message_id BIGINT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    solved_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    UNIQUE (puzzle_id, user_id)
);
CREATE INDEX idx_puzzle_progress_user_status ON puzzle_progress (user_id, status);
CREATE INDEX idx_puzzle_progress_user_sent ON puzzle_progress (user_id, sent_at DESC);

-- 6) Seed the state machine: already-analyzed games are 'analyzed' (ready to
--    generate); everything else stays 'ingested'.
UPDATE player_games pg SET status = 'analyzed', status_updated_at = now()
FROM game_analyses ga
WHERE ga.player_game_id = pg.id;

COMMIT;
