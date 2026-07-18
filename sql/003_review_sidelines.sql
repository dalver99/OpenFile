-- Saved user-created analysis branches from the web Game Review board.
-- Safe to re-run: additive and IF NOT EXISTS guarded.

SET search_path TO user_chess_analysis, public;

CREATE TABLE IF NOT EXISTS review_sidelines (
    id BIGSERIAL PRIMARY KEY,
    player_game_id BIGINT NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    anchor_ply INTEGER NOT NULL CHECK (anchor_ply >= 0),
    start_fen TEXT NOT NULL,
    moves_uci JSONB NOT NULL DEFAULT '[]'::jsonb,
    moves_san JSONB NOT NULL DEFAULT '[]'::jsonb,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_sidelines_game_user
    ON review_sidelines (player_game_id, user_id, updated_at DESC);
