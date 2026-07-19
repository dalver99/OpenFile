import { localOperationsEnabled, spawnChesspipe, spawnDetachedChesspipe } from "@/server/runtime/chesspipe-process";
import { queueGameAnalysis, markGameAnalysisFailed } from "@/server/repositories/games";
import { setCollectionMembership } from "@/server/repositories/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportResult = {
  status?: string;
  reason?: string;
  player_game_id?: number;
  existing?: boolean;
  game_url?: string;
};

function positiveId(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function importWithWorker(url: string): Promise<ImportResult> {
  const child = spawnChesspipe(
    ["-m", "chesspipe.cli", "import-game", "--url", url],
    { TARGET_USER_ID: process.env.WEBUI_USER_ID ?? "1" },
  );
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Chess.com archive search timed out."));
    }, 180_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-256_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.trim()) as ImportResult);
      } catch {
        reject(new Error(stderr.trim().slice(-500) || "The importer returned an invalid response."));
      }
    });
  });
}

function startAnalysis(playerGameId: number) {
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

export async function POST(request: Request) {
  if (!localOperationsEnabled()) {
    return Response.json({ error: "local_operations_disabled" }, { status: 403 });
  }
  let body: { url?: unknown; analyze?: unknown; collectionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const url = String(body.url ?? "").trim().slice(0, 500);
  if (!/^https?:\/\/(?:www\.)?chess\.com\//i.test(url)) {
    return Response.json({ error: "invalid_chesscom_url" }, { status: 400 });
  }

  let imported: ImportResult;
  try {
    imported = await importWithWorker(url);
  } catch (error) {
    return Response.json({
      error: "import_failed",
      detail: error instanceof Error ? error.message : "Could not import that game.",
    }, { status: 502 });
  }
  const playerGameId = positiveId(imported.player_game_id);
  if (imported.status !== "ok" || playerGameId == null) {
    return Response.json({ error: "game_not_found", detail: imported.reason }, { status: 404 });
  }

  const collectionId = positiveId(body.collectionId);
  if (collectionId != null) {
    const membership = await setCollectionMembership(collectionId, playerGameId, true);
    if (membership === "missing") {
      return Response.json({ error: "collection_not_found" }, { status: 404 });
    }
  }

  let analysisStatus: "not_requested" | "ready" | "analyzing" | "queued" = "not_requested";
  if (body.analyze === true) {
    const queued = await queueGameAnalysis(playerGameId);
    if (queued === "ready") analysisStatus = "ready";
    else if (queued === "running") analysisStatus = "analyzing";
    else if (queued === "queued") {
      analysisStatus = "queued";
      startAnalysis(playerGameId);
    }
  }
  return Response.json({
    gameId: playerGameId,
    existing: imported.existing === true,
    gameUrl: imported.game_url,
    analysisStatus,
  }, { status: imported.existing ? 200 : 201 });
}
