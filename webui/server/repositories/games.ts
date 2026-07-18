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
import { pool } from "@/server/database/postgres";
import { WEBUI_USER_ID } from "@/server/current-user";

const requestedTimezone = process.env.WEBUI_TIMEZONE ?? "Asia/Seoul";
try {
  new Intl.DateTimeFormat("en-US", { timeZone: requestedTimezone }).format();
} catch {
  throw new Error(`Invalid WEBUI_TIMEZONE: ${requestedTimezone}`);
}
const WEBUI_TIMEZONE = requestedTimezone.replaceAll("'", "''");

const gameColumns = `
         pg.id, g.white_username, g.black_username,
         g.white_rating, g.black_rating, g.white_result, g.black_result,
         to_char(g.end_time AT TIME ZONE '${WEBUI_TIMEZONE}', 'YYYY-MM-DD') AS played_at,
         g.time_class, g.time_control, pg.side, pg.result, pg.rating_after,
         pg.status, pg.status_detail,
         CASE WHEN g.eco_url IS NULL THEN NULL
              ELSE replace(regexp_replace(g.eco_url, '^.*/', ''), '-', ' ')
         END AS opening,
         (ga.id IS NOT NULL) AS analyzed,
         ga.depth AS analysis_depth`;

const gameFrom = `
  FROM player_games pg
  JOIN chesscom_games g ON g.id = pg.game_id
  LEFT JOIN game_analyses ga ON ga.player_game_id = pg.id`;

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
  return { games: rows as GameCard[], total, page, pageSize, totalPages };
}

export async function getGameArchiveStats(): Promise<GameArchiveStats> {
  const { rows } = await pool.query<GameArchiveStats>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ga.id IS NOT NULL)::int AS reviewed
     ${gameFrom}
     WHERE pg.player_id = $1 AND g.rules = 'chess'`,
    [WEBUI_USER_ID],
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    reviewed: Number(rows[0]?.reviewed ?? 0),
  };
}

export async function getGameReview(playerGameId: number): Promise<GameReview | null> {
  const { rows } = await pool.query(
    `SELECT ${gameColumns}, g.chesscom_url, ga.engine_id,
            to_char(ga.created_at AT TIME ZONE '${WEBUI_TIMEZONE}', 'YYYY-MM-DD HH24:MI') AS analysis_created_at
     ${gameFrom}
     WHERE pg.id = $1 AND pg.player_id = $2`,
    [playerGameId, WEBUI_USER_ID],
  );
  if (!rows.length) return null;

  const game = rows[0] as GameReview["game"];
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
            created_at::text, updated_at::text
     FROM review_sidelines
     WHERE player_game_id = $1 AND user_id = $2
     ORDER BY updated_at DESC, id DESC`,
    [playerGameId, WEBUI_USER_ID],
  );
  return {
    game,
    moves: moveResult.rows as ReviewMove[],
    sidelines: sidelineResult.rows as ReviewSideline[],
  };
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
       SELECT $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7
       WHERE EXISTS (
         SELECT 1 FROM player_games WHERE id = $1 AND player_id = $2
       )
       RETURNING id, anchor_ply, start_fen, moves_uci, moves_san, title,
                 created_at::text, updated_at::text`
    : `UPDATE review_sidelines
       SET anchor_ply = $3, start_fen = $4, moves_uci = $5::jsonb,
           moves_san = $6::jsonb, title = $7, updated_at = now()
       WHERE id = $8 AND player_game_id = $1 AND user_id = $2
       RETURNING id, anchor_ply, start_fen, moves_uci, moves_san, title,
                 created_at::text, updated_at::text`;
  const { rows } = await pool.query(query, id == null ? params : [...params, id]);
  return rows.length ? rows[0] as ReviewSideline : null;
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

export async function queueGameAnalysis(playerGameId: number): Promise<
  "missing" | "ready" | "running" | "queued"
> {
  const state = await getGameAnalysisStatus(playerGameId);
  if (!state.found) return "missing";
  if (state.analyzed) return "ready";
  if (state.status === "analyzing") return "running";

  const result = await pool.query(
    `UPDATE player_games
     SET status = 'selected', status_detail = 'web_review_queued', status_updated_at = now()
     WHERE id = $1 AND player_id = $2
       AND (
         status IN ('ingested', 'failed')
         OR (status = 'selected' AND status_detail IS DISTINCT FROM 'web_review_queued')
       )
       AND NOT EXISTS (SELECT 1 FROM game_analyses ga WHERE ga.player_game_id = player_games.id)
     RETURNING id`,
    [playerGameId, WEBUI_USER_ID],
  );
  return result.rowCount ? "queued" : "running";
}

export async function markGameAnalysisFailed(playerGameId: number, detail: string): Promise<void> {
  await pool.query(
    `UPDATE player_games
     SET status = 'failed', status_detail = $3, status_updated_at = now()
     WHERE id = $1 AND player_id = $2 AND status IN ('selected', 'analyzing')`,
    [playerGameId, WEBUI_USER_ID, detail.slice(0, 500)],
  );
}
