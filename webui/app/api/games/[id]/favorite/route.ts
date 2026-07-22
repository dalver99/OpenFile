import { setGameFavorite } from "@/server/data/games";
import { isDemoMode } from "@/server/demo-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gameIdFrom(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function update(
  favorite: boolean,
  { params }: { params: Promise<{ id: string }> },
) {
  const gameId = gameIdFrom((await params).id);
  if (gameId == null) {
    return Response.json({ error: "invalid_game_id" }, { status: 400 });
  }
  const status = await setGameFavorite(gameId, favorite);
  if (status === "missing") {
    return Response.json({ error: "game_not_found" }, { status: 404 });
  }
  return Response.json({ favorite, demo: isDemoMode() });
}

export async function PUT(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return update(true, context);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return update(false, context);
}
