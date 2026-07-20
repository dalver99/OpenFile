import { spawn } from "node:child_process";
import { Chess } from "chess.js";
import {
  localOperationsEnabled,
  spawnChesspipe,
} from "@/server/runtime/chesspipe-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  var _positionAnalysisProcess: ReturnType<typeof spawn> | undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function POST(request: Request) {
  if (!localOperationsEnabled()) {
    return Response.json({ error: "local_analysis_disabled" }, { status: 403 });
  }

  let body: { fen?: string; depth?: number; multipv?: number; timeSec?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const fen = String(body.fen ?? "").trim();
  if (!fen || fen.length > 120) {
    return Response.json({ error: "invalid_fen" }, { status: 400 });
  }
  try {
    new Chess(fen);
  } catch {
    return Response.json({ error: "invalid_fen" }, { status: 400 });
  }

  const depth = Math.round(Math.max(8, Math.min(22, finiteNumber(body.depth, 14))));
  const multipv = Math.round(Math.max(1, Math.min(5, finiteNumber(body.multipv, 3))));
  const timeSec = Math.max(0.25, Math.min(10, finiteNumber(body.timeSec, 1.5)));

  // Only the newest board position matters in an interactive analysis room.
  // Supersede an older search before starting another local Stockfish process.
  if (global._positionAnalysisProcess && global._positionAnalysisProcess.exitCode == null) {
    global._positionAnalysisProcess.kill("SIGTERM");
  }

  const child = spawnChesspipe(
    [
      "-m", "chesspipe.cli", "position",
      "--fen", fen,
      "--depth", String(depth),
      "--multipv", String(multipv),
      "--time", String(timeSec),
      "--max-pv", "14",
    ],
  );
  global._positionAnalysisProcess = child;

  return await new Promise<Response>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (response: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(Response.json({ error: "analysis_timeout" }, { status: 504 }));
    }, Math.ceil(timeSec * 1_000) + 20_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-256_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
    });
    child.on("error", (error) => {
      finish(Response.json({ error: "engine_start_failed", detail: error.message }, { status: 500 }));
    });
    child.on("close", (code, signal) => {
      if (global._positionAnalysisProcess === child) {
        global._positionAnalysisProcess = undefined;
      }
      if (settled) return;
      if (signal === "SIGTERM") {
        finish(Response.json({ error: "analysis_superseded" }, { status: 409 }));
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(stdout.trim());
      } catch {
        finish(Response.json({ error: "invalid_engine_output", detail: stderr.slice(-500) }, { status: 500 }));
        return;
      }
      if (code !== 0) {
        finish(Response.json(data, { status: 500 }));
        return;
      }
      finish(Response.json(data, { headers: { "Cache-Control": "no-store" } }));
    });
  });
}
