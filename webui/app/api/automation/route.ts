import {
  localOperationsEnabled,
  spawnChesspipe,
  spawnDetachedChesspipe,
} from "@/server/runtime/chesspipe-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutomationStatus = {
  status: string;
  enabled?: boolean;
  last_run?: { status?: string } | null;
  detail?: string;
};

function runJson(args: string[]): Promise<AutomationStatus> {
  return new Promise((resolve, reject) => {
    const child = spawnChesspipe(["-m", "chesspipe.cli", "automation", ...args]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("automation_command_timed_out"));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(stdout) as AutomationStatus;
        if (code === 0) resolve(value);
        else reject(new Error(value.detail || stderr.trim() || "automation_command_failed"));
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || "invalid_automation_response"));
      }
    });
  });
}

export async function GET() {
  try {
    const status = await runJson(["status"]);
    return Response.json(
      { ...status, operations_enabled: localOperationsEnabled() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "automation_status_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!localOperationsEnabled()) {
    return Response.json({ error: "local_operations_disabled" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    if (body.action === "disable") {
      return Response.json(await runJson(["disable"]));
    }
    if (body.action === "run") {
      const current = await runJson(["status"]);
      if (current.last_run?.status === "running") {
        return Response.json({ error: "routine_already_running" }, { status: 409 });
      }
      const child = spawnDetachedChesspipe([
        "-m", "chesspipe.cli", "automation", "run",
      ]);
      child.unref();
      return Response.json({ status: "accepted" }, { status: 202 });
    }
    if (body.action !== "enable") {
      return Response.json({ error: "invalid_action" }, { status: 400 });
    }

    const args = [
      "enable",
      "--preset", String(body.preset ?? "puzzles"),
      "--frequency", String(body.frequency ?? "daily"),
      "--hour", String(body.hour ?? 9),
      "--weekday", String(body.weekday ?? 0),
      "--analyze-count", String(body.analyze_count ?? 2),
      "--puzzle-count", String(body.puzzle_count ?? 2),
    ];
    return Response.json(await runJson(args));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "automation_update_failed" },
      { status: 400 },
    );
  }
}
