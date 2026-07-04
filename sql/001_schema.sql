-- Chess puzzle pipeline schema (database-first, single clean file).
-- Apply on database `cccron` as the app role. References public.users(user_id,
-- chessdotcom_id, deleted).
--
-- HOW TO APPLY: run sql/000_reset.sql first (clean slate), then paste this
-- whole file into your SQL console and run it. The SET below creates every
-- table in the app schema (matches chesspipe/db.py's search_path at runtime).

SET search_path TO user_chess_analysis, public;
--
-- Pipeline state machine lives on player_games.status:
--   ingested -> selected -> analyzing -> analyzed
--            -> generating -> (puzzled | no_puzzle) ; failed on error
-- 'analyzing'/'generating' are transient claim states: a worker flips the row
-- to them (committing immediately) so it never holds a row lock across a long
-- engine call. Each stage claims work with SELECT ... FOR UPDATE SKIP LOCKED,
-- so the stages can run as independent (and concurrent) jobs / Lambda functions.

-- ---------------------------------------------------------------------------
-- Ingest: raw games from Chess.com.
-- ---------------------------------------------------------------------------
CREATE TABLE chesscom_games (
    id BIGSERIAL PRIMARY KEY,
    chesscom_url TEXT NOT NULL UNIQUE,
    white_username TEXT NOT NULL,
    black_username TEXT NOT NULL,
    white_rating INTEGER,
    black_rating INTEGER,
    white_result TEXT,
    black_result TEXT,
    end_time TIMESTAMPTZ,
    time_class TEXT,
    time_control TEXT,
    rules TEXT NOT NULL,
    rated BOOLEAN,
    eco_url TEXT,
    pgn TEXT NOT NULL,
    raw_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chesscom_games_end_time ON chesscom_games (end_time DESC);

-- Player <-> game link plus the per-(player, game) pipeline status.
CREATE TABLE player_games (
    id BIGSERIAL PRIMARY KEY,
    player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('white', 'black')),
    result TEXT NOT NULL,
    is_loss BOOLEAN NOT NULL DEFAULT FALSE,
    rating_after INTEGER,
    status TEXT NOT NULL DEFAULT 'ingested'
        CHECK (status IN (
            'ingested', 'selected', 'analyzing', 'analyzed',
            'generating', 'puzzled', 'no_puzzle', 'failed'
        )),
    status_detail TEXT,
    status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (player_id, game_id)
);
CREATE INDEX idx_player_games_status ON player_games (status, player_id);
CREATE INDEX idx_player_games_loss ON player_games (player_id, is_loss, status);

-- ---------------------------------------------------------------------------
-- Openings: retained at the game level for future opening-weakness analysis.
-- Populated at ingest from Chess.com's eco_url. Not wired into puzzles.
-- ---------------------------------------------------------------------------
CREATE TABLE openings (
    id BIGSERIAL PRIMARY KEY,
    eco_url TEXT UNIQUE,
    eco_code TEXT,
    name TEXT,
    family TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_openings (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    opening_id BIGINT NOT NULL REFERENCES openings(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'chesscom_eco',
    confidence NUMERIC(5, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, opening_id, source)
);

-- ---------------------------------------------------------------------------
-- Analyze: whole-game Stockfish analysis and per-move detail.
-- ---------------------------------------------------------------------------
CREATE TABLE game_analyses (
    id BIGSERIAL PRIMARY KEY,
    player_game_id BIGINT NOT NULL UNIQUE REFERENCES player_games(id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    engine_id TEXT NOT NULL,
    depth INTEGER NOT NULL,
    multipv INTEGER NOT NULL,
    summary_json JSONB NOT NULL,
    engine_analysis_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_game_analyses_player_created ON game_analyses (player_id, created_at DESC);

CREATE TABLE move_analyses (
    id BIGSERIAL PRIMARY KEY,
    game_analysis_id BIGINT NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    ply INTEGER NOT NULL,
    move_number INTEGER NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('white', 'black')),
    move_uci TEXT NOT NULL,
    san TEXT NOT NULL,
    classification TEXT NOT NULL,
    centipawn_loss INTEGER,
    evaluation_before_cp INTEGER,
    evaluation_after_cp INTEGER,
    evaluation_change_cp INTEGER,
    played_rank INTEGER,
    top_moves JSONB NOT NULL DEFAULT '[]'::jsonb,
    fen_before TEXT,
    fen_after TEXT,
    UNIQUE (game_analysis_id, ply)
);
CREATE INDEX idx_move_analyses_ga_ply ON move_analyses (game_analysis_id, ply);

-- ---------------------------------------------------------------------------
-- Generate: Lichess-style forced-sequence puzzles.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Deliver + solve. Telegram is one delivery channel; solve state is stored
-- channel-agnostically so a future web UI reads/writes the same rows.
-- ---------------------------------------------------------------------------
CREATE TABLE telegram_users (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    telegram_id BIGINT NOT NULL UNIQUE,
    telegram_username TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    daily_quota INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (user, puzzle): the solve state, independent of channel.
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
