PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    chessdotcom_id TEXT NOT NULL UNIQUE,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chesscom_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chesscom_url TEXT NOT NULL UNIQUE,
    white_username TEXT NOT NULL,
    black_username TEXT NOT NULL,
    white_rating INTEGER,
    black_rating INTEGER,
    white_result TEXT,
    black_result TEXT,
    end_time TEXT,
    time_class TEXT,
    time_control TEXT,
    rules TEXT NOT NULL,
    rated INTEGER,
    eco_url TEXT,
    pgn TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chesscom_games_end_time ON chesscom_games (end_time DESC);

CREATE TABLE IF NOT EXISTS player_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('white', 'black')),
    result TEXT NOT NULL,
    is_loss INTEGER NOT NULL DEFAULT 0,
    rating_after INTEGER,
    status TEXT NOT NULL DEFAULT 'ingested',
    status_detail TEXT,
    status_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_player_games_status ON player_games (status, player_id);

CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'complete', 'failed', 'cancelled')),
    phase TEXT NOT NULL DEFAULT 'connecting',
    archive_months INTEGER NOT NULL,
    max_games INTEGER NOT NULL,
    refresh_existing INTEGER NOT NULL DEFAULT 0,
    archives_total INTEGER NOT NULL DEFAULT 0,
    archives_done INTEGER NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    existing_count INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_user_started
    ON sync_runs (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_run_games (
    sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
    player_game_id INTEGER NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
    time_class TEXT,
    PRIMARY KEY (sync_run_id, player_game_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_run_games_run_time
    ON sync_run_games (sync_run_id, time_class);

CREATE TABLE IF NOT EXISTS favorite_games (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    player_game_id INTEGER NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, player_game_id)
);
CREATE INDEX IF NOT EXISTS idx_favorite_games_user_created
    ON favorite_games (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#a12222',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_game_collections_user_updated
    ON game_collections (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_games (
    collection_id INTEGER NOT NULL REFERENCES game_collections(id) ON DELETE CASCADE,
    player_game_id INTEGER NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, player_game_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_games_player_game
    ON collection_games (player_game_id, added_at DESC);

CREATE TABLE IF NOT EXISTS openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eco_url TEXT UNIQUE,
    eco_code TEXT,
    name TEXT,
    family TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    opening_id INTEGER NOT NULL REFERENCES openings(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'chesscom_eco',
    confidence REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (game_id, opening_id, source)
);

CREATE TABLE IF NOT EXISTS game_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_game_id INTEGER NOT NULL UNIQUE REFERENCES player_games(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    engine_id TEXT NOT NULL,
    depth INTEGER NOT NULL,
    multipv INTEGER NOT NULL,
    summary_json TEXT NOT NULL,
    engine_analysis_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS move_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_analysis_id INTEGER NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
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
    top_moves TEXT NOT NULL DEFAULT '[]',
    fen_before TEXT,
    fen_after TEXT,
    UNIQUE (game_analysis_id, ply)
);
CREATE INDEX IF NOT EXISTS idx_move_analyses_ga_ply ON move_analyses (game_analysis_id, ply);

CREATE TABLE IF NOT EXISTS review_sidelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_game_id INTEGER NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    anchor_ply INTEGER NOT NULL CHECK (anchor_ply >= 0),
    start_fen TEXT NOT NULL,
    moves_uci TEXT NOT NULL DEFAULT '[]',
    moves_san TEXT NOT NULL DEFAULT '[]',
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS puzzles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_analysis_id INTEGER NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    source_player_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    mistake_ply INTEGER NOT NULL,
    fen_before TEXT NOT NULL,
    last_move_uci TEXT,
    solution_uci TEXT NOT NULL,
    solution_san TEXT,
    solution_line_uci TEXT NOT NULL DEFAULT '[]',
    side_to_move TEXT NOT NULL CHECK (side_to_move IN ('white', 'black')),
    phase TEXT,
    tag TEXT,
    themes TEXT NOT NULL DEFAULT '[]',
    cp_loss INTEGER,
    is_mate INTEGER NOT NULL DEFAULT 0,
    mate_in INTEGER,
    difficulty INTEGER,
    quality_score INTEGER,
    time_class TEXT,
    opponent_username TEXT,
    played_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (game_analysis_id, mistake_ply)
);

CREATE TABLE IF NOT EXISTS puzzle_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'solved', 'revealed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'web',
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    solved_at TEXT,
    last_attempt_at TEXT,
    UNIQUE (puzzle_id, user_id)
);
