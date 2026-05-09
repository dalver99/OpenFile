-- Chess analysis schema (database-first). Apply on database cccron.

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

CREATE TABLE player_games (
    id BIGSERIAL PRIMARY KEY,
    player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('white', 'black')),
    result TEXT NOT NULL,
    rating_after INTEGER,
    opponent_player_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (player_id, game_id)
);

CREATE TABLE analysis_runs (
    id BIGSERIAL PRIMARY KEY,
    run_date DATE NOT NULL,
    player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    reason TEXT,
    selected_game_id BIGINT REFERENCES chesscom_games(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (run_date, player_id)
);

CREATE TABLE game_analyses (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    stockfish_depth INTEGER NOT NULL,
    stockfish_multipv INTEGER NOT NULL DEFAULT 3,
    stockfish_api_url TEXT,
    server_schema_version INTEGER NOT NULL DEFAULT 1,
    heuristic_version INTEGER NOT NULL DEFAULT 1,
    summary_json JSONB NOT NULL,
    engine_analysis_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, player_id, stockfish_depth, stockfish_multipv, heuristic_version)
);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_analysis_id, ply)
);

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

CREATE TABLE tags (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_analysis_tags (
    id BIGSERIAL PRIMARY KEY,
    game_analysis_id BIGINT NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual',
    confidence NUMERIC(5, 4),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_analysis_id, tag_id, source)
);

CREATE INDEX idx_chesscom_games_end_time ON chesscom_games (end_time DESC);
CREATE INDEX idx_player_games_player_result_game ON player_games (player_id, result, game_id);
CREATE INDEX idx_analysis_runs_player_date ON analysis_runs (player_id, run_date DESC);
CREATE INDEX idx_game_analyses_player_created ON game_analyses (player_id, created_at DESC);
CREATE INDEX idx_move_analyses_classification ON move_analyses (classification);
CREATE INDEX idx_move_analyses_game_analysis_ply ON move_analyses (game_analysis_id, ply);
CREATE INDEX idx_game_analysis_tags_tag_id ON game_analysis_tags (tag_id);
