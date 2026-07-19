-- Denormalize a few game-context fields onto `puzzles` so every delivery
-- surface (webui, Telegram, HTML preview) can show them without extra joins:
--   time_class        -- bullet | blitz | rapid | daily (from Chess.com)
--   opponent_username -- the non-tracked side's Chess.com username
--   played_at         -- the source game's end_time
--
-- Safe to re-run: additive, IF NOT EXISTS guarded, backfill is idempotent.
-- Apply directly against an existing database (paste into your SQL console).

SET search_path TO user_chess_analysis, public;

ALTER TABLE puzzles
    ADD COLUMN IF NOT EXISTS time_class TEXT,
    ADD COLUMN IF NOT EXISTS opponent_username TEXT,
    ADD COLUMN IF NOT EXISTS played_at TIMESTAMPTZ;

UPDATE puzzles p
SET time_class = g.time_class,
    opponent_username = CASE WHEN pg.side = 'white' THEN g.black_username ELSE g.white_username END,
    played_at = g.end_time
FROM chesscom_games g, player_games pg
WHERE g.id = p.game_id
  AND pg.game_id = p.game_id
  AND pg.player_id = p.source_player_id
  AND (p.time_class IS NULL OR p.opponent_username IS NULL OR p.played_at IS NULL);
