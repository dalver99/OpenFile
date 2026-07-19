-- DESTRUCTIVE clean-slate reset. Drops every pipeline table in the app schema
-- so sql/001_schema.sql can recreate them from scratch.
--
-- NOTE: If you have an existing database with analyses worth keeping, use
-- sql/migrate_legacy.sql instead — it preserves games and Stockfish analyses
-- and only rebuilds the puzzle layer. This full reset also loses those.
--
-- Safe to lose: games are re-downloaded by `chesspipe ingest`; puzzles/analyses
-- are regenerated. NOTE: this also drops telegram_users, so re-insert your
-- Telegram linkage afterwards (see the template at the bottom of this file).
--
-- HOW TO APPLY: paste this whole file into your SQL console and run it, then
-- paste and run sql/001_schema.sql. The SET below targets the app schema.

SET search_path TO user_chess_analysis, public;

DROP TABLE IF EXISTS
    puzzle_progress,
    puzzle_deliveries,      -- old
    puzzles,
    move_analyses,
    game_analyses,
    analysis_runs,          -- old
    game_analysis_tags,     -- old
    tags,                   -- old
    game_openings,
    openings,
    player_games,
    telegram_users,
    chesscom_games
CASCADE;

-- After applying 001_schema.sql, re-link your Telegram user (fill in the ids):
--   INSERT INTO telegram_users (user_id, telegram_id, telegram_username, daily_quota)
--   VALUES (1, <your_telegram_id>, '<optional_username>', 3);
