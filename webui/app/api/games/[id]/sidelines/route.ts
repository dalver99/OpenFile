import { Chess } from "chess.js";
import {
  deleteReviewSideline,
  getSidelineAnchorFen,
  saveReviewSideline,
} from "@/server/data/games";
import { isDemoMode } from "@/server/demo-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseGameId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizedUci(value: unknown): string | null {
  const move = String(value ?? "").trim().toLowerCase();
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const playerGameId = parseGameId((await params).id);
  if (playerGameId == null) {
    return Response.json({ error: "invalid_game_id" }, { status: 400 });
  }

  let body: { id?: unknown; anchorPly?: unknown; movesUci?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const sidelineId = body.id == null ? null : Number(body.id);
  const anchorPly = Number(body.anchorPly);
  if ((sidelineId != null && (!Number.isInteger(sidelineId) || sidelineId <= 0)) ||
      !Number.isInteger(anchorPly) || anchorPly < 0) {
    return Response.json({ error: "invalid_sideline" }, { status: 400 });
  }
  if (!Array.isArray(body.movesUci) || body.movesUci.length < 1 || body.movesUci.length > 200) {
    return Response.json({ error: "invalid_move_list" }, { status: 400 });
  }
  const movesUci = body.movesUci.map(normalizedUci);
  if (movesUci.some((move) => move == null)) {
    return Response.json({ error: "invalid_move" }, { status: 400 });
  }

  const startFen = await getSidelineAnchorFen(playerGameId, anchorPly);
  if (!startFen) {
    return Response.json({ error: "game_or_anchor_not_found" }, { status: 404 });
  }

  const chess = new Chess(startFen);
  const movesSan: string[] = [];
  try {
    for (const uci of movesUci as string[]) {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
      movesSan.push(move.san);
    }
  } catch {
    return Response.json({ error: "illegal_sideline_move" }, { status: 400 });
  }

  const requestedTitle = String(body.title ?? "").trim().slice(0, 100);
  const title = requestedTitle || `Sideline after ply ${anchorPly}`;
  const sideline = await saveReviewSideline({
    id: sidelineId,
    playerGameId,
    anchorPly,
    startFen,
    movesUci: movesUci as string[],
    movesSan,
    title,
  });
  if (!sideline) {
    return Response.json({ error: "sideline_not_found" }, { status: 404 });
  }
  return Response.json({ sideline, demo: isDemoMode() });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const playerGameId = parseGameId((await params).id);
  if (playerGameId == null) {
    return Response.json({ error: "invalid_game_id" }, { status: 400 });
  }

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const sidelineId = Number(body.id);
  if (!Number.isInteger(sidelineId) || sidelineId <= 0) {
    return Response.json({ error: "invalid_sideline_id" }, { status: 400 });
  }

  const deleted = await deleteReviewSideline(sidelineId, playerGameId);
  return deleted
    ? Response.json({ ok: true, demo: isDemoMode() })
    : Response.json({ error: "sideline_not_found" }, { status: 404 });
}
