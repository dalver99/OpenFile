import {
  getGameAnalysisStatus,
  markGameAnalysisFailed,
  queueGameAnalysis,
} from "@/server/repositories/games";
import { spawnDetachedChesspipe } from "@/server/runtime/chesspipe-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function startWorker(playerGameId: number) {
  const worker = spawnDetachedChesspipe(
    ["-m", "chesspipe.cli", "analyze", "--player-game-id", String(playerGameId)],
    { TARGET_USER_ID: process.env.WEBUI_USER_ID ?? "1" },
  );
  worker.on("error", (error) => {
    void markGameAnalysisFailed(playerGameId, `Could not launch analysis worker: ${error.message}`);
  });
  worker.on("exit", (code) => {
    if (code != null && code !== 0) {
      void markGameAnalysisFailed(playerGameId, `Analysis worker exited with status ${code}.`);
    }
  });
  worker.unref();
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id == null) return Response.json({ error: "invalid_game_id" }, { status: 400 });
  const state = await getGameAnalysisStatus(id);
  if (!state.found) return Response.json({ error: "game_not_found" }, { status: 404 });
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id == null) return Response.json({ error: "invalid_game_id" }, { status: 400 });

  const result = await queueGameAnalysis(id);
  if (result === "missing") return Response.json({ error: "game_not_found" }, { status: 404 });
  if (result === "ready") return Response.json({ analyzed: true, status: "analyzed" });
  if (result === "queued") startWorker(id);

  return Response.json({ analyzed: false, status: result === "running" ? "analyzing" : "selected" }, { status: 202 });
}
