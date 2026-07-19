import "server-only";

import { pool } from "@/server/database/sqlite";
import { WEBUI_USER_ID } from "@/server/current-user";

export type SyncStatus = "running" | "complete" | "failed" | "cancelled";

export type SyncRun = {
  id: number;
  username: string;
  status: SyncStatus;
  phase: string;
  archiveMonths: number;
  maxGames: number;
  refreshExisting: boolean;
  archivesTotal: number;
  archivesDone: number;
  checked: number;
  added: number;
  existing: number;
  processed: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  timeClasses: Record<string, number>;
};

type SyncRow = Record<string, unknown> & {
  id: number;
  username: string;
  status: SyncStatus;
  phase: string;
  archive_months: number;
  max_games: number;
  refresh_existing: number;
  archives_total: number;
  archives_done: number;
  checked: number;
  added: number;
  existing_count: number;
  processed: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

async function hydrate(row: SyncRow | undefined): Promise<SyncRun | null> {
  if (!row) return null;
  const counts = await pool.query<{ time_class: string | null; total: number }>(
    `SELECT COALESCE(time_class, 'other') AS time_class, count(*) AS total
     FROM sync_run_games
     WHERE sync_run_id = $1
     GROUP BY COALESCE(time_class, 'other')`,
    [row.id],
  );
  return {
    id: Number(row.id),
    username: String(row.username),
    status: row.status,
    phase: String(row.phase),
    archiveMonths: Number(row.archive_months),
    maxGames: Number(row.max_games),
    refreshExisting: Boolean(row.refresh_existing),
    archivesTotal: Number(row.archives_total),
    archivesDone: Number(row.archives_done),
    checked: Number(row.checked),
    added: Number(row.added),
    existing: Number(row.existing_count),
    processed: Number(row.processed),
    error: row.error ? String(row.error) : null,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    timeClasses: Object.fromEntries(
      counts.rows.map((item) => [String(item.time_class ?? "other"), Number(item.total)]),
    ),
  };
}

const selectRun = `
  SELECT sr.*, u.chessdotcom_id AS username
  FROM sync_runs sr
  JOIN users u ON u.user_id = sr.user_id`;

export async function getLatestSyncRun(): Promise<SyncRun | null> {
  const { rows } = await pool.query<SyncRow>(
    `${selectRun}
     WHERE sr.user_id = $1
     ORDER BY datetime(sr.started_at) DESC, sr.id DESC
     LIMIT 1`,
    [WEBUI_USER_ID],
  );
  return hydrate(rows[0]);
}

export async function getSyncRun(id: number): Promise<SyncRun | null> {
  const { rows } = await pool.query<SyncRow>(
    `${selectRun} WHERE sr.id = $1 AND sr.user_id = $2`,
    [id, WEBUI_USER_ID],
  );
  return hydrate(rows[0]);
}

export async function createSyncRun({
  archiveMonths,
  maxGames,
  refreshExisting,
}: {
  archiveMonths: number;
  maxGames: number;
  refreshExisting: boolean;
}): Promise<SyncRun> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_runs (
       user_id, status, phase, archive_months, max_games, refresh_existing
     ) VALUES ($1, 'running', 'connecting', $2, $3, $4)
     RETURNING id`,
    [WEBUI_USER_ID, archiveMonths, maxGames, refreshExisting],
  );
  const run = await getSyncRun(Number(rows[0].id));
  if (!run) throw new Error("sync_run_create_failed");
  return run;
}

export async function finishSyncRun(
  id: number,
  status: "failed" | "cancelled",
  error: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE sync_runs
     SET status = $3, phase = $3, error = $4, finished_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2 AND status = 'running'`,
    [id, WEBUI_USER_ID, status, error?.slice(0, 1_000) ?? null],
  );
}

/**
 * A web-server restart can lose the child-process handle while leaving its
 * database row in `running`. Keep a generous grace period so a genuinely slow
 * Chess.com request is not mistaken for an orphan.
 */
export async function failStaleSyncRuns(maxAgeMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  const result = await pool.query(
    `UPDATE sync_runs
     SET status = 'failed', phase = 'failed',
         error = 'The OpenFile worker stopped reporting. Retry the sync.',
         finished_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND status = 'running'
       AND datetime(started_at) < datetime($2)`,
    [WEBUI_USER_ID, cutoff],
  );
  return result.rowCount ?? 0;
}
