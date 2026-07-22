export const dynamic = "force-dynamic";

type Action = "ingest" | "analyze" | "generate";

const idle = (action: Action, message: string) => ({
  action,
  status: "idle",
  message,
  output: "",
  startedAt: null,
  finishedAt: null,
});

function syncRun(id = 1, timestamp = "2026-07-20T10:00:00Z") {
  return {
    id,
    username: "dalv3r",
    status: "complete",
    phase: "saving",
    archiveMonths: 1,
    maxGames: 100,
    refreshExisting: false,
    archivesTotal: 1,
    archivesDone: 1,
    checked: 8,
    added: 0,
    existing: 8,
    processed: 0,
    error: null,
    startedAt: timestamp,
    finishedAt: timestamp,
    timeClasses: { rapid: 6, blitz: 2 },
  };
}

export async function GET() {
  return Response.json({
    enabled: true,
    operations: {
      ingest: idle("ingest", "Demo sync preview"),
      analyze: idle("analyze", "Demo queue preview"),
      generate: idle("generate", "Puzzle generation requires the local app"),
    },
    syncRun: syncRun(),
    syncDefaults: { username: "dalv3r", archiveMonths: 1, maxGames: 100 },
    analysisDefaults: { depth: 16, multipv: 1, deepDepth: 20, deepMultipv: 3, deepMaxMoves: 12 },
    demo: true,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: { action?: string; gameIds?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const timestamp = new Date().toISOString();
  if (body.action === "ingest") {
    return Response.json({ demo: true, syncRun: syncRun(2, timestamp) });
  }
  if (body.action === "analyze") {
    const total = Array.isArray(body.gameIds) ? body.gameIds.length : 1;
    return Response.json({
      demo: true,
      queuedIds: body.gameIds ?? [],
      operation: {
        action: "analyze",
        status: "complete",
        message: `Demo preview: ${total} ${total === 1 ? "game" : "games"} selected; no engine was run.`,
        output: "",
        startedAt: timestamp,
        finishedAt: timestamp,
        total,
        completed: total,
        failed: 0,
      },
    });
  }
  if (body.action === "generate") {
    return Response.json({ error: "demo_puzzle_generation_unavailable" }, { status: 409 });
  }
  return Response.json({ error: "invalid_action" }, { status: 400 });
}

export async function DELETE() {
  return Response.json({ error: "demo_has_no_running_sync" }, { status: 409 });
}
