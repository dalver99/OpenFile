-- Puzzle generation + Telegram delivery schema.
-- Apply after sql/001_create_tables.sql on database cccron.
--
-- These tables back analysis_cron/puzzles/generator.py and analysis_cron/bot/*.
-- They were previously used by the code but missing from the committed schema.

CREATE TABLE puzzles (
    id BIGSERIAL PRIMARY KEY,
    move_analysis_id BIGINT NOT NULL UNIQUE REFERENCES move_analyses(id) ON DELETE CASCADE,
    game_analysis_id BIGINT NOT NULL REFERENCES game_analyses(id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES chesscom_games(id) ON DELETE CASCADE,
    source_player_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    fen_before TEXT NOT NULL,
    last_move_uci TEXT,
    solution_uci TEXT NOT NULL,
    solution_san TEXT,
    side_to_move TEXT NOT NULL CHECK (side_to_move IN ('white', 'black')),
    phase TEXT,
    tag TEXT,
    cp_loss INTEGER,
    top1_cp INTEGER,
    top2_cp INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE telegram_users (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    telegram_id BIGINT NOT NULL UNIQUE,
    telegram_username TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    daily_quota INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE puzzle_deliveries (
    id BIGSERIAL PRIMARY KEY,
    puzzle_id BIGINT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
    telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'solved', 'revealed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    chat_message_id BIGINT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    solved_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    UNIQUE (puzzle_id, telegram_user_id)
);

CREATE INDEX idx_puzzles_source_player ON puzzles (source_player_id);
CREATE INDEX idx_puzzles_phase ON puzzles (phase);
CREATE INDEX idx_puzzle_deliveries_user_status ON puzzle_deliveries (telegram_user_id, status);
CREATE INDEX idx_puzzle_deliveries_user_sent_at ON puzzle_deliveries (telegram_user_id, sent_at DESC);
