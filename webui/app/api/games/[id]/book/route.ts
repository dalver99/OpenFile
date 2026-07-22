import { getGameReview } from "@/server/data/games";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "invalid_game_id" }, { status: 400 });
  }
  const review = await getGameReview(id);
  if (!review?.moves.length) {
    return Response.json({ available: false, error: "game_not_analyzed" });
  }
  return Response.json({
    available: true,
    source: "snapshot",
    moves: review.moves
      .filter((move) => move.classification === "book")
      .map((move) => ({
        ply: move.ply,
        book: true,
        games: 0,
        eco: null,
        openingName: review.game.opening,
      })),
    demo: true,
  });
}
