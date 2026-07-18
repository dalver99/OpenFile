import {
  localOperationsEnabled,
  spawnChesspipe,
} from "@/server/runtime/chesspipe-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "ingest" | "analyze";
type Operation = {
  action: Action;
  status: "idle" | "running" | "complete" | "failed";
  message: string;
  output: string;
  startedAt: string | null;
  finishedAt: string | null;
};

declare global {
  var _chesspipeOperations: Record<Action, Operation> | undefined;
}

const initialOperations: Record<Action, Operation> = {
  ingest: { action: "ingest", status: "idle", message: "Ready to sync", output: "", startedAt: null, finishedAt: null },
  analyze: { action: "analyze", status: "idle", message: "Ready to analyze", output: "", startedAt: null, finishedAt: null },
};

const operations = global._chesspipeOperations ?? initialOperations;
global._chesspipeOperations = operations;

function commandSteps(action: Action): string[][] {
  if (action === "ingest") {
    return [["-m", "chesspipe.cli", "ingest"]];
  }
  return [
    ["-m", "chesspipe.cli", "select", "--limit", "1"],
    ["-m", "chesspipe.cli", "analyze"],
  ];
}

function appendOutput(action: Action, chunk: string) {
  operations[action].output = `${operations[action].output}${chunk}`.slice(-8_000);
}

function runStep(action: Action, steps: string[][], index: number) {
  const child = spawnChesspipe(steps[index], {
    TARGET_USER_ID: process.env.WEBUI_USER_ID ?? "1",
  });

  child.stdout.on("data", (chunk: Buffer) => appendOutput(action, chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => appendOutput(action, chunk.toString()));
  child.on("error", (error) => {
    operations[action] = {
      ...operations[action],
      status: "failed",
      message: `Could not start the local worker: ${error.message}`,
      finishedAt: new Date().toISOString(),
    };
  });
  child.on("close", (code) => {
    if (code !== 0) {
      operations[action] = {
        ...operations[action],
        status: "failed",
        message: `The local worker stopped with status ${code ?? "unknown"}.`,
        finishedAt: new Date().toISOString(),
      };
      return;
    }
    if (index + 1 < steps.length) {
      operations[action].message = "Starting Stockfish analysis…";
      runStep(action, steps, index + 1);
      return;
    }
    operations[action] = {
      ...operations[action],
      status: "complete",
      message:
        action === "ingest"
          ? (() => {
              const fetched = operations[action].output.match(/"fetched"\s*:\s*(\d+)/)?.[1];
              const imported = operations[action].output.match(/"upserted"\s*:\s*(\d+)/)?.[1];
              return fetched && imported
                ? `Chess.com sync complete — ${imported} new of ${fetched} recent games.`
                : "Chess.com games are up to date.";
            })()
          : "Local analysis finished.",
      finishedAt: new Date().toISOString(),
    };
  });
}

function startOperation(action: Action) {
  operations[action] = {
    action,
    status: "running",
    message: action === "ingest" ? "Fetching recent Chess.com games…" : "Selecting the next game…",
    output: "",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const steps = commandSteps(action);
  runStep(action, steps, 0);
}

export async function GET() {
  return Response.json(
    { enabled: localOperationsEnabled(), operations },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!localOperationsEnabled()) {
    return Response.json(
      { error: "local_operations_disabled" },
      { status: 403 },
    );
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.action !== "ingest" && body.action !== "analyze") {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }

  const action = body.action;
  if (operations[action].status === "running") {
    return Response.json({ operation: operations[action] }, { status: 409 });
  }
  startOperation(action);
  return Response.json({ operation: operations[action] }, { status: 202 });
}
