import "server-only";

import type { PuzzleCard } from "@/domain/puzzles";
import { pool } from "@/server/database/sqlite";
import { WEBUI_USER_ID } from "@/server/current-user";

type PuzzleSolution = {
  solution_uci: string;
  solution_san: string | null;
  solution_line_uci: string[];
};

declare global {
  var _puzzleSolutionCache: Map<string, PuzzleSolution> | undefined;
}

const solutionCache = global._puzzleSolutionCache ?? new Map<string, PuzzleSolution>();
global._puzzleSolutionCache = solutionCache;

function solutionCacheKey(puzzleId: number): string {
  return `${WEBUI_USER_ID}:${puzzleId}`;
}

export async function listPuzzles(limit = 100): Promise<PuzzleCard[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.fen_before, p.last_move_uci, p.side_to_move, p.phase, p.tag,
            p.themes, p.cp_loss, p.is_mate, p.mate_in, p.difficulty, p.quality_score,
            p.solution_uci, p.solution_san, p.solution_line_uci,
            p.time_class, p.opponent_username, substr(p.played_at, 1, 10) AS played_at,
            pp.status AS progress_status, COALESCE(pp.attempts, 0) AS attempts
     FROM puzzles p
     LEFT JOIN puzzle_progress pp ON pp.puzzle_id = p.id AND pp.user_id = $1
     WHERE p.source_player_id = $1
     ORDER BY (pp.status = 'solved') ASC NULLS FIRST,
              COALESCE(p.quality_score, 0) DESC, p.id ASC
     LIMIT $2`,
    [WEBUI_USER_ID, limit],
  );
  return rows.map((raw) => {
    const row = raw as PuzzleCard & PuzzleSolution;
    row.themes = typeof row.themes === "string" ? JSON.parse(row.themes) : row.themes;
    row.solution_line_uci = typeof row.solution_line_uci === "string"
      ? JSON.parse(row.solution_line_uci)
      : row.solution_line_uci;
    solutionCache.set(solutionCacheKey(row.id), {
      solution_uci: row.solution_uci,
      solution_san: row.solution_san,
      solution_line_uci: row.solution_line_uci,
    });
    const card = { ...row } as Partial<PuzzleCard & PuzzleSolution>;
    delete card.solution_uci;
    delete card.solution_san;
    delete card.solution_line_uci;
    return card as PuzzleCard;
  });
}

export async function getPuzzleSolution(puzzleId: number): Promise<PuzzleSolution | null> {
  const key = solutionCacheKey(puzzleId);
  const cached = solutionCache.get(key);
  if (cached) return cached;

  const { rows } = await pool.query(
    `SELECT solution_uci, solution_san, solution_line_uci
     FROM puzzles
     WHERE id = $1 AND source_player_id = $2`,
    [puzzleId, WEBUI_USER_ID],
  );
  if (!rows.length) return null;
  const raw = rows[0] as PuzzleSolution;
  const solution = {
    ...raw,
    solution_line_uci: typeof raw.solution_line_uci === "string"
      ? JSON.parse(raw.solution_line_uci)
      : raw.solution_line_uci,
  };
  solutionCache.set(key, solution);
  return solution;
}

export async function recordPuzzleProgress(
  puzzleId: number,
  outcome: "solved" | "revealed" | "attempt",
): Promise<void> {
  const status = outcome === "attempt" ? "sent" : outcome;
  await pool.query(
    `INSERT INTO puzzle_progress
        (puzzle_id, user_id, status, attempts, channel, solved_at, last_attempt_at)
     VALUES ($1, $2, $3, 1, 'web',
             CASE WHEN $3 = 'solved' THEN now() END, now())
     ON CONFLICT (puzzle_id, user_id) DO UPDATE SET
        status = CASE WHEN puzzle_progress.status = 'solved' THEN 'solved' ELSE EXCLUDED.status END,
        attempts = puzzle_progress.attempts + 1,
        solved_at = COALESCE(puzzle_progress.solved_at,
                             CASE WHEN EXCLUDED.status = 'solved' THEN now() END),
        last_attempt_at = now()`,
    [puzzleId, WEBUI_USER_ID, status],
  );
}
