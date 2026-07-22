import { getGameAnalysisStatus } from "@/server/data/games";

export const dynamic = "force-dynamic";

function idFrom(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (id == null) return Response.json({ error: "invalid_game_id" }, { status: 400 });
  const state = await getGameAnalysisStatus(id);
  if (!state.found) return Response.json({ error: "game_not_found" }, { status: 404 });
  return Response.json({ ...state, demo: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (id == null) return Response.json({ error: "invalid_game_id" }, { status: 400 });
  return Response.json({
    error: "demo_analysis_unavailable",
    detail: "The hosted demo cannot start Stockfish. Open a completed sample review instead.",
  }, { status: 409 });
}
