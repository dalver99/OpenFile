import "server-only";

import type {
  GameCard,
  GameArchiveStats,
  GameListFilters,
  GamePage,
  GameReview,
  ReviewMove,
  ReviewSideline,
} from "@/domain/games";
import { pool } from "@/server/database/sqlite";
import { WEBUI_USER_ID } from "@/server/current-user";

const gameColumns = `
         pg.id, g.white_username, g.black_username,
         g.white_rating, g.black_rating, g.white_result, g.black_result,
         substr(g.end_time, 1, 10) AS played_at,
         g.time_class, g.time_control, pg.side, pg.result, pg.rating_after,
         pg.status, pg.status_detail,
         CASE WHEN g.eco_url IS NULL THEN NULL
              WHEN instr(g.eco_url, '/openings/') > 0
              THEN replace(substr(g.eco_url, instr(g.eco_url, '/openings/') + 10), '-', ' ')
              ELSE g.eco_url
         END AS opening,
         (ga.id IS NOT NULL) AS analyzed,
         ga.depth AS analysis_depth,
         EXISTS (
           SELECT 1 FROM favorite_games fg
           WHERE fg.player_game_id = pg.id AND fg.user_id = pg.player_id
         ) AS is_favorite`;

const gameFrom = `
  FROM player_games pg
  JOIN chesscom_games g ON g.id = pg.game_id
  LEFT JOIN game_analyses ga ON ga.player_game_id = pg.id`;

function clockSeconds(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function pgnClocks(pgn: string): Array<number | null> {
  return [...pgn.matchAll(/\[%clk\s+([^\]]+)\]/g)].map((match) => clockSeconds(match[1]));
}

export async function listGames(
  filters: GameListFilters,
  requestedPage = 1,
  requestedPageSize = 40,
): Promise<GamePage> {
  const params: Array<string | number> = [WEBUI_USER_ID];
  const conditions = ["pg.player_id = $1", "g.rules = 'chess'"];

  if (filters.timeClass !== "all") {
    params.push(filters.timeClass);
    conditions.push(`g.time_class = $${params.length}`);
  }
  if (filters.review === "reviewed") conditions.push("ga.id IS NOT NULL");
  if (filters.review === "waiting") conditions.push("ga.id IS NULL");
  if (filters.favorite === "favorites") {
    conditions.push(`EXISTS (
      SELECT 1 FROM favorite_games fg
      WHERE fg.player_game_id = pg.id AND fg.user_id = pg.player_id
    )`);
  }
  if (filters.syncRunId !== null) {
    params.push(filters.syncRunId);
    conditions.push(`EXISTS (
      SELECT 1
      FROM sync_run_games srg
      JOIN sync_runs sr ON sr.id = srg.sync_run_id
      WHERE srg.player_game_id = pg.id
        AND srg.sync_run_id = $${params.length}
        AND sr.user_id = pg.player_id
    )`);
  }
  if (filters.query) {
    params.push(`%${filters.query}%`);
    const queryParam = `$${params.length}`;
    conditions.push(`(
      g.white_username ILIKE ${queryParam}
      OR g.black_username ILIKE ${queryParam}
      OR COALESCE(g.eco_url, '') ILIKE ${queryParam}
    )`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total ${gameFrom} ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const pageSize = Math.max(10, Math.min(100, requestedPageSize));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(totalPages, requestedPage));
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const { rows } = await pool.query(
    `SELECT ${gameColumns}
     ${gameFrom}
     ${where}
     ORDER BY g.end_time DESC NULLS LAST, pg.id DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  return {
    games: rows.map((row) => ({
      ...row,
      analyzed: Boolean(row.analyzed),
      is_favorite: Boolean(row.is_favorite),
    })) as GameCard[],
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getGameArchiveStats(): Promise<GameArchiveStats> {
  const { rows } = await pool.query<GameArchiveStats>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ga.id IS NOT NULL)::int AS reviewed,
            count(*) FILTER (WHERE ga.id IS NULL)::int AS waiting,
            count(*) FILTER (
              WHERE ga.id IS NULL AND pg.status IN ('selected', 'analyzing')
            )::int AS analyzing
     ${gameFrom}
     WHERE pg.player_id = $1 AND g.rules = 'chess'`,
    [WEBUI_USER_ID],
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    reviewed: Number(rows[0]?.reviewed ?? 0),
    waiting: Number(rows[0]?.waiting ?? 0),
    analyzing: Number(rows[0]?.analyzing ?? 0),
  };
}

export async function listAnalysisCandidates(requestedLimit = 80): Promise<GameCard[]> {
  const limit = Math.max(10, Math.min(200, requestedLimit));
  const { rows } = await pool.query(
    `SELECT ${gameColumns}
     ${gameFrom}
     WHERE pg.player_id = $1
       AND g.rules = 'chess'
       AND ga.id IS NULL
     ORDER BY
       CASE WHEN pg.status IN ('selected', 'analyzing') THEN 0 ELSE 1 END,
       CASE WHEN EXISTS (
         SELECT 1 FROM favorite_games fg
         WHERE fg.player_game_id = pg.id AND fg.user_id = pg.player_id
       ) THEN 0 ELSE 1 END,
       CASE WHEN pg.result NOT IN (
         'win', 'agreed', 'stalemate', 'repetition', 'insufficient',
         '50move', 'timevsinsufficient'
       ) THEN 0 ELSE 1 END,
       g.end_time DESC,
       pg.id DESC
     LIMIT $2`,
    [WEBUI_USER_ID, limit],
  );
  return rows.map((row) => ({
    ...row,
    analyzed: false,
    is_favorite: Boolean(row.is_favorite),
  })) as GameCard[];
}

export async function getGameReview(playerGameId: number): Promise<GameReview | null> {
  const { rows } = await pool.query(
    `SELECT ${gameColumns}, g.chesscom_url, g.pgn, ga.engine_id,
            substr(ga.created_at, 1, 16) AS analysis_created_at
     ${gameFrom}
     WHERE pg.id = $1 AND pg.player_id = $2`,
    [playerGameId, WEBUI_USER_ID],
  );
  if (!rows.length) return null;

  const { pgn, ...gameRow } = rows[0];
  const clocks = pgnClocks(String(pgn ?? ""));
  const game = {
    ...gameRow,
    analyzed: Boolean(rows[0].analyzed),
    is_favorite: Boolean(rows[0].is_favorite),
  } as GameReview["game"];
  if (!game.analyzed) return { game, moves: [], sidelines: [] };

  const moveResult = await pool.query(
    `SELECT ma.ply, ma.move_number, ma.side, ma.move_uci, ma.san,
            ma.classification, ma.centipawn_loss, ma.evaluation_before_cp,
            ma.evaluation_after_cp, ma.evaluation_change_cp, ma.played_rank,
            ma.top_moves, ma.fen_before, ma.fen_after
     FROM move_analyses ma
     JOIN game_analyses ga ON ga.id = ma.game_analysis_id
     WHERE ga.player_game_id = $1 AND ga.player_id = $2
     ORDER BY ma.ply`,
    [playerGameId, WEBUI_USER_ID],
  );
  const sidelineResult = await pool.query(
    `SELECT id, anchor_ply, start_fen, moves_uci, moves_san, title,
            created_at, updated_at
     FROM review_sidelines
     WHERE player_game_id = $1 AND user_id = $2
     ORDER BY updated_at DESC, id DESC`,
    [playerGameId, WEBUI_USER_ID],
  );
  return {
    game,
    moves: moveResult.rows.map((row, index) => ({
      ...row,
      top_moves: typeof row.top_moves === "string" ? JSON.parse(row.top_moves) : row.top_moves,
      clock_seconds: clocks[index] ?? null,
    })) as ReviewMove[],
    sidelines: sidelineResult.rows.map((row) => ({
      ...row,
      moves_uci: typeof row.moves_uci === "string" ? JSON.parse(row.moves_uci) : row.moves_uci,
      moves_san: typeof row.moves_san === "string" ? JSON.parse(row.moves_san) : row.moves_san,
    })) as ReviewSideline[],
  };
}

export async function setGameFavorite(
  playerGameId: number,
  favorite: boolean,
): Promise<"missing" | "saved"> {
  if (favorite) {
    const result = await pool.query(
      `INSERT INTO favorite_games (user_id, player_game_id)
       SELECT $2, pg.id
       FROM player_games pg
       WHERE pg.id = $1 AND pg.player_id = $2
       ON CONFLICT(user_id, player_game_id) DO UPDATE
       SET created_at = favorite_games.created_at
       RETURNING player_game_id`,
      [playerGameId, WEBUI_USER_ID],
    );
    return result.rowCount ? "saved" : "missing";
  }

  const owned = await pool.query(
    `SELECT id FROM player_games WHERE id = $1 AND player_id = $2`,
    [playerGameId, WEBUI_USER_ID],
  );
  if (!owned.rowCount) return "missing";
  await pool.query(
    `DELETE FROM favorite_games WHERE player_game_id = $1 AND user_id = $2`,
    [playerGameId, WEBUI_USER_ID],
  );
  return "saved";
}

export async function getSidelineAnchorFen(
  playerGameId: number,
  anchorPly: number,
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT CASE
              WHEN $3 = 0 THEN first_move.fen_before
              ELSE anchor_move.fen_after
            END AS start_fen
     FROM game_analyses ga
     JOIN player_games pg ON pg.id = ga.player_game_id
     LEFT JOIN move_analyses first_move
       ON first_move.game_analysis_id = ga.id AND first_move.ply = 1
     LEFT JOIN move_analyses anchor_move
       ON anchor_move.game_analysis_id = ga.id AND anchor_move.ply = $3
     WHERE ga.player_game_id = $1 AND pg.player_id = $2`,
    [playerGameId, WEBUI_USER_ID, anchorPly],
  );
  return rows[0]?.start_fen ? String(rows[0].start_fen) : null;
}

export async function saveReviewSideline({
  id,
  playerGameId,
  anchorPly,
  startFen,
  movesUci,
  movesSan,
  title,
}: {
  id: number | null;
  playerGameId: number;
  anchorPly: number;
  startFen: string;
  movesUci: string[];
  movesSan: string[];
  title: string;
}): Promise<ReviewSideline | null> {
  const params = [
    playerGameId,
    WEBUI_USER_ID,
    anchorPly,
    startFen,
    JSON.stringify(movesUci),
    JSON.stringify(movesSan),
    title,
  ];
  const query = id == null
    ? `INSERT INTO review_sidelines
         (player_game_id, user_id, anchor_ply, start_fen, moves_uci, moves_san, title)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE EXISTS (
         SELECT 1 FROM player_games WHERE id = $1 AND player_id = $2
       )
       RETURNING id, anchor_ply, start_fen, moves_uci, moves_san, title,
                 created_at, updated_at`
    : `UPDATE review_sidelines
       SET anchor_ply = $3, start_fen = $4, moves_uci = $5,
           moves_san = $6, title = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND player_game_id = $1 AND user_id = $2
       RETURNING id, anchor_ply, start_fen, moves_uci, moves_san, title,
                 created_at, updated_at`;
  const { rows } = await pool.query(query, id == null ? params : [...params, id]);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    moves_uci: typeof row.moves_uci === "string" ? JSON.parse(row.moves_uci) : row.moves_uci,
    moves_san: typeof row.moves_san === "string" ? JSON.parse(row.moves_san) : row.moves_san,
  } as ReviewSideline;
}

export async function deleteReviewSideline(
  id: number,
  playerGameId: number,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM review_sidelines
     WHERE id = $1 AND player_game_id = $2 AND user_id = $3
     RETURNING id`,
    [id, playerGameId, WEBUI_USER_ID],
  );
  return Boolean(result.rowCount);
}

export async function getGameAnalysisStatus(playerGameId: number): Promise<{
  found: boolean;
  analyzed: boolean;
  status: string | null;
  detail: string | null;
}> {
  const { rows } = await pool.query(
    `SELECT pg.status, pg.status_detail, (ga.id IS NOT NULL) AS analyzed
     FROM player_games pg
     LEFT JOIN game_analyses ga ON ga.player_game_id = pg.id
     WHERE pg.id = $1 AND pg.player_id = $2`,
    [playerGameId, WEBUI_USER_ID],
  );
  if (!rows.length) return { found: false, analyzed: false, status: null, detail: null };
  return {
    found: true,
    analyzed: Boolean(rows[0].analyzed),
    status: String(rows[0].status),
    detail: rows[0].status_detail ? String(rows[0].status_detail) : null,
  };
}

export async function queueGameAnalysis(playerGameId: number, force = false): Promise<
  "missing" | "ready" | "running" | "queued"
> {
  const state = await getGameAnalysisStatus(playerGameId);
  if (!state.found) return "missing";
  if (state.analyzed && !force) return "ready";
  if (state.status === "analyzing") return "running";

  const result = await pool.query(
    `UPDATE player_games
     SET status = 'selected', status_detail = 'web_review_queued', status_updated_at = now()
     WHERE id = $1 AND player_id = $2
       AND status NOT IN ('analyzing', 'generating')
       AND (
         $3 = 1
         OR (
           status IN ('ingested', 'failed')
           OR (status = 'selected' AND status_detail IS DISTINCT FROM 'web_review_queued')
         )
       )
       AND (
         $3 = 1
         OR NOT EXISTS (SELECT 1 FROM game_analyses ga WHERE ga.player_game_id = player_games.id)
       )
     RETURNING id`,
    [playerGameId, WEBUI_USER_ID, force ? 1 : 0],
  );
  return result.rowCount ? "queued" : "running";
}

export async function queueGameAnalyses(playerGameIds: number[]): Promise<number[]> {
  const uniqueIds = [...new Set(playerGameIds)].filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
  const queued: number[] = [];
  for (const playerGameId of uniqueIds) {
    if (await queueGameAnalysis(playerGameId) === "queued") {
      queued.push(playerGameId);
    }
  }
  return queued;
}

export async function hasActiveGameAnalysis(): Promise<boolean> {
  const result = await pool.query(
    `SELECT id
     FROM player_games
     WHERE player_id = $1 AND status = 'analyzing'
     LIMIT 1`,
    [WEBUI_USER_ID],
  );
  return Boolean(result.rowCount);
}

export async function markGameAnalysisFailed(playerGameId: number, detail: string): Promise<void> {
  await pool.query(
    `UPDATE player_games
     SET status = 'failed', status_detail = $3, status_updated_at = now()
     WHERE id = $1 AND player_id = $2 AND status IN ('selected', 'analyzing')`,
    [playerGameId, WEBUI_USER_ID, detail.slice(0, 500)],
  );
}
