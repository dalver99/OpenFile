import {
  localOperationsEnabled,
  spawnChesspipe,
} from "@/server/runtime/chesspipe-process";
import { localConfig } from "@/server/database/config";
import {
  createSyncRun,
  failStaleSyncRuns,
  finishSyncRun,
  getLatestSyncRun,
} from "@/server/repositories/sync";
import {
  hasActiveGameAnalysis,
  queueGameAnalyses,
} from "@/server/repositories/games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "ingest" | "analyze";
type Operation = {
  action: Action;
  status: "idle" | "running" | "complete" | "failed" | "cancelled";
  message: string;
  output: string;
  startedAt: string | null;
  finishedAt: string | null;
  runId?: number;
  total?: number;
  completed?: number;
  failed?: number;
};

declare global {
  var _openFileOperations: Record<Action, Operation> | undefined;
  var _openFileOperationProcesses:
    | Partial<Record<Action, ReturnType<typeof spawnChesspipe>>>
    | undefined;
}

const initialOperations: Record<Action, Operation> = {
  ingest: { action: "ingest", status: "idle", message: "Ready to sync", output: "", startedAt: null, finishedAt: null },
  analyze: { action: "analyze", status: "idle", message: "Ready to analyze", output: "", startedAt: null, finishedAt: null },
};

const operations = global._openFileOperations ?? initialOperations;
const processes = global._openFileOperationProcesses ?? {};
global._openFileOperations = operations;
global._openFileOperationProcesses = processes;

function appendOutput(action: Action, chunk: string) {
  operations[action].output = `${operations[action].output}${chunk}`.slice(-8_000);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function runAnalyzeStep(
  steps: string[][],
  index: number,
  nonGameSteps = 0,
  analysisEnvironment: Partial<NodeJS.ProcessEnv> = {},
) {
  const action: Action = "analyze";
  const child = spawnChesspipe(steps[index], {
    TARGET_USER_ID: process.env.WEBUI_USER_ID ?? "1",
    ...analysisEnvironment,
  });
  processes.analyze = child;
  child.stdout.on("data", (chunk: Buffer) => appendOutput(action, chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => appendOutput(action, chunk.toString()));
  child.on("error", (error) => {
    operations.analyze = {
      ...operations.analyze,
      status: "failed",
      message: `Could not start the local worker: ${error.message}`,
      finishedAt: new Date().toISOString(),
    };
  });
  child.on("close", (code) => {
    delete processes.analyze;
    if (operations.analyze.status === "cancelled") return;
    if (code !== 0) {
      operations.analyze.failed = (operations.analyze.failed ?? 0) + 1;
    }
    operations.analyze.completed = Math.max(0, index + 1 - nonGameSteps);
    if (index + 1 < steps.length) {
      const nextGame = Math.max(1, index + 2 - nonGameSteps);
      operations.analyze.message = `Analyzing game ${nextGame} of ${operations.analyze.total ?? 1}…`;
      runAnalyzeStep(steps, index + 1, nonGameSteps, analysisEnvironment);
      return;
    }
    const failed = operations.analyze.failed ?? 0;
    const total = operations.analyze.total ?? 1;
    operations.analyze = {
      ...operations.analyze,
      status: failed >= total ? "failed" : "complete",
      message: failed
        ? `Finished ${Math.max(0, total - failed)} of ${total} reviews; ${failed} failed.`
        : `${total === 1 ? "Review" : `${total} reviews`} ready.`,
      finishedAt: new Date().toISOString(),
    };
  });
}

function startAnalysis(
  playerGameIds?: number[],
  analysisEnvironment: Partial<NodeJS.ProcessEnv> = {},
) {
  const steps = playerGameIds?.length
    ? playerGameIds.map((id) => [
        "-m", "chesspipe.cli", "analyze", "--player-game-id", String(id),
      ])
    : [
        ["-m", "chesspipe.cli", "select", "--limit", "1"],
        ["-m", "chesspipe.cli", "analyze"],
      ];
  operations.analyze = {
    action: "analyze",
    status: "running",
    message: playerGameIds?.length
      ? `Analyzing game 1 of ${playerGameIds.length}…`
      : "Selecting the next game…",
    output: "",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: playerGameIds?.length ?? 1,
    completed: 0,
    failed: 0,
  };
  runAnalyzeStep(steps, 0, playerGameIds?.length ? 0 : 1, analysisEnvironment);
}

async function startSync(options: {
  archiveMonths: number;
  maxGames: number;
  refreshExisting: boolean;
}) {
  const run = await createSyncRun(options);
  operations.ingest = {
    action: "ingest",
    status: "running",
    message: "Connecting to Chess.com…",
    output: "",
    startedAt: run.startedAt,
    finishedAt: null,
    runId: run.id,
  };
  const args = [
    "-m", "chesspipe.cli", "ingest",
    "--months", String(options.archiveMonths),
    "--max-games", String(options.maxGames),
    "--sync-run-id", String(run.id),
  ];
  if (options.refreshExisting) args.push("--force");
  const child = spawnChesspipe(args, {
    TARGET_USER_ID: process.env.WEBUI_USER_ID ?? "1",
  });
  processes.ingest = child;
  child.stdout.on("data", (chunk: Buffer) => appendOutput("ingest", chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => appendOutput("ingest", chunk.toString()));
  child.on("error", (error) => {
    void finishSyncRun(run.id, "failed", error.message);
    operations.ingest = {
      ...operations.ingest,
      status: "failed",
      message: `Could not start synchronization: ${error.message}`,
      finishedAt: new Date().toISOString(),
    };
  });
  child.on("close", (code) => {
    delete processes.ingest;
    if (operations.ingest.status === "cancelled") return;
    if (code !== 0) {
      const detail = operations.ingest.output.trim().slice(-1_000)
        || `The local worker stopped with status ${code ?? "unknown"}.`;
      void finishSyncRun(run.id, "failed", detail);
      operations.ingest = {
        ...operations.ingest,
        status: "failed",
        message: "Chess.com synchronization failed.",
        finishedAt: new Date().toISOString(),
      };
      return;
    }
    operations.ingest = {
      ...operations.ingest,
      status: "complete",
      message: "Chess.com synchronization finished.",
      finishedAt: new Date().toISOString(),
    };
  });
  return run;
}

export async function GET() {
  if (!processes.ingest) await failStaleSyncRuns();
  const config = localConfig();
  return Response.json(
    {
      enabled: localOperationsEnabled(),
      operations,
      syncRun: await getLatestSyncRun(),
      syncDefaults: {
        username: config.chesscom_username?.trim() || null,
        archiveMonths: boundedInteger(config.recent_archive_months, 1, 1, 24),
        maxGames: boundedInteger(config.max_sync_games, 100, 10, 2_000),
      },
      analysisDefaults: {
        depth: boundedInteger(config.analysis_depth, 16, 8, 24),
        multipv: boundedInteger(config.analysis_multipv, 1, 1, 5),
        deepDepth: boundedInteger(config.analysis_deep_depth, 20, 10, 26),
        deepMultipv: boundedInteger(config.analysis_deep_multipv, 3, 1, 5),
        deepMaxMoves: boundedInteger(config.analysis_deep_max_moves, 12, 0, 30),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!localOperationsEnabled()) {
    return Response.json({ error: "local_operations_disabled" }, { status: 403 });
  }
  let body: {
    action?: string;
    archiveMonths?: unknown;
    maxGames?: unknown;
    refreshExisting?: unknown;
    gameIds?: unknown;
    analysisOptions?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.action !== "ingest" && body.action !== "analyze") {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }
  if (body.action === "analyze") {
    if (operations.analyze.status === "running") {
      return Response.json({ operation: operations.analyze }, { status: 409 });
    }
    if (body.gameIds !== undefined) {
      if (!Array.isArray(body.gameIds) || body.gameIds.length < 1 || body.gameIds.length > 20) {
        return Response.json({ error: "invalid_game_ids" }, { status: 400 });
      }
      const requestedIds = body.gameIds.map(Number);
      if (requestedIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        return Response.json({ error: "invalid_game_ids" }, { status: 400 });
      }
      const rawOptions = body.analysisOptions;
      if (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions)) {
        return Response.json({ error: "invalid_analysis_options" }, { status: 400 });
      }
      const options = rawOptions as Record<string, unknown>;
      const depth = Math.round(Number(options.depth));
      const multipv = Math.round(Number(options.multipv));
      const deepDepth = Math.round(Number(options.deepDepth));
      const deepMultipv = Math.round(Number(options.deepMultipv));
      const deepMaxMoves = Math.round(Number(options.deepMaxMoves));
      if (
        !Number.isInteger(depth) || depth < 8 || depth > 24
        || !Number.isInteger(multipv) || multipv < 1 || multipv > 5
        || !Number.isInteger(deepDepth) || deepDepth < depth || deepDepth > 26
        || !Number.isInteger(deepMultipv) || deepMultipv < 1 || deepMultipv > 5
        || !Number.isInteger(deepMaxMoves) || deepMaxMoves < 0 || deepMaxMoves > 30
      ) {
        return Response.json({ error: "invalid_analysis_options" }, { status: 400 });
      }
      if (await hasActiveGameAnalysis()) {
        return Response.json({ error: "analysis_in_progress" }, { status: 409 });
      }
      const queuedIds = await queueGameAnalyses(requestedIds);
      if (!queuedIds.length) {
        return Response.json({ error: "no_games_queued" }, { status: 409 });
      }
      startAnalysis(queuedIds, {
        ANALYSIS_DEPTH: String(depth),
        ANALYSIS_MULTIPV: String(multipv),
        ANALYSIS_DEEP_DEPTH: String(deepDepth),
        ANALYSIS_DEEP_MULTIPV: String(deepMultipv),
        ANALYSIS_DEEP_MAX_MOVES: String(deepMaxMoves),
      });
      return Response.json({ operation: operations.analyze, queuedIds }, { status: 202 });
    }
    startAnalysis();
    return Response.json({ operation: operations.analyze }, { status: 202 });
  }

  if (!processes.ingest) await failStaleSyncRuns();
  const latest = await getLatestSyncRun();
  if (latest?.status === "running") {
    return Response.json({ syncRun: latest }, { status: 409 });
  }
  const archiveMonths = Math.round(Number(body.archiveMonths));
  const maxGames = Math.round(Number(body.maxGames));
  if (!Number.isInteger(archiveMonths) || archiveMonths < 1 || archiveMonths > 24) {
    return Response.json({ error: "invalid_archive_months" }, { status: 400 });
  }
  if (!Number.isInteger(maxGames) || maxGames < 10 || maxGames > 2_000) {
    return Response.json({ error: "invalid_max_games" }, { status: 400 });
  }
  const syncRun = await startSync({
    archiveMonths,
    maxGames,
    refreshExisting: body.refreshExisting === true,
  });
  return Response.json({ operation: operations.ingest, syncRun }, { status: 202 });
}

export async function DELETE(request: Request) {
  if (!localOperationsEnabled()) {
    return Response.json({ error: "local_operations_disabled" }, { status: 403 });
  }
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.action !== "ingest") {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }
  const latest = await getLatestSyncRun();
  if (!latest || latest.status !== "running") {
    return Response.json({ error: "sync_not_running" }, { status: 409 });
  }
  operations.ingest = {
    ...operations.ingest,
    status: "cancelled",
    message: "Synchronization cancelled.",
    finishedAt: new Date().toISOString(),
  };
  await finishSyncRun(latest.id, "cancelled", "Cancelled by user.");
  processes.ingest?.kill("SIGTERM");
  return Response.json({ syncRun: await getLatestSyncRun() });
}
