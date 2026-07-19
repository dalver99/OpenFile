import "server-only";

import { Pool } from "pg";

// Route the app schema onto search_path for every connection (set at startup via
// the libpq `options` parameter), so unqualified table names resolve to the app
// schema, matching the pipeline.
const rawSchema = process.env.DB_SCHEMA || "user_chess_analysis";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSchema)) {
  throw new Error(`Invalid DB_SCHEMA: ${rawSchema}`);
}

declare global {
  var _pgPool: Pool | undefined;
}

function normalizedConnectionString(value: string): string {
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get("sslmode");
    // pg currently treats these modes as certificate-verifying aliases. Make
    // that behavior explicit so the pg v9 semantic change cannot weaken it.
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (see webui/.env.local).");
  }
  return new Pool({
    connectionString: normalizedConnectionString(connectionString),
    options: `-c search_path=${rawSchema},public`,
    max: 3,
  });
}

// Reuse the pool across hot reloads in dev.
export const pool = global._pgPool ?? createPool();
// pg removes and replaces an idle client when its remote connection drops.
// Listening prevents EventEmitter from promoting that recoverable event to an
// uncaught exception while keeping a concise diagnostic in the server log.
if (pool.listenerCount("error") === 0) {
  pool.on("error", (error) => {
    console.warn(`[database] idle connection dropped; reconnecting: ${error.message}`);
  });
}
if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
