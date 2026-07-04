-- Puzzle quality/theme enrichment. Additive and idempotent: safe to run on an
-- existing database. Apply after sql/002_create_puzzle_tables.sql.

ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS themes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS solution_line_uci JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS difficulty INTEGER;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS is_mate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS mate_in INTEGER;

-- Serve higher-quality puzzles first.
CREATE INDEX IF NOT EXISTS idx_puzzles_quality ON puzzles (quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_puzzles_phase_quality ON puzzles (phase, quality_score DESC);
