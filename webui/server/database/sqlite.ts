import "server-only";

import { DatabaseSync } from "node:sqlite";
import { databasePath } from "@/server/database/config";

type QueryResult<T> = { rows: T[]; rowCount: number };

declare global {
  var _openFileDatabase: DatabaseSync | undefined;
}

function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(databasePath());
  // Set the wait policy before WAL or additive migrations. Next.js can import
  // server modules in parallel build workers, and each process may open the
  // same local database at nearly the same time.
  database.exec("PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  // Keep small additive migrations available to an existing local database even
  // when the web UI is the first OpenFile process started after an upgrade.
  database.exec(`
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
  `);
  return database;
}

const database = global._openFileDatabase ?? openDatabase();
if (process.env.NODE_ENV !== "production") global._openFileDatabase = database;

function compile(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const ordered: unknown[] = [];
  let compiled = sql.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
    ordered.push(params[Number(rawIndex) - 1]);
    return "?";
  });
  compiled = compiled
    .replace(/::(?:int|text|jsonb)/g, "")
    .replace(/\bnow\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bILIKE\b/g, "LIKE");
  return {
    sql: compiled,
    params: ordered.map((value) => {
      if (Array.isArray(value) || (value != null && typeof value === "object")) {
        return JSON.stringify(value);
      }
      if (typeof value === "boolean") return value ? 1 : 0;
      return value;
    }),
  };
}

export const pool = {
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const query = compile(sql, params);
    const statement = database.prepare(query.sql);
    if (/^\s*(?:SELECT|WITH)\b/i.test(query.sql) || /\bRETURNING\b/i.test(query.sql)) {
      const rows = statement.all(...query.params) as T[];
      return { rows, rowCount: rows.length };
    }
    const result = statement.run(...query.params);
    return { rows: [], rowCount: Number(result.changes) };
  },
};
