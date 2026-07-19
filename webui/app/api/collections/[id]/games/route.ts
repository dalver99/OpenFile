import { setCollectionMembership } from "@/server/repositories/collections";

export const runtime = "nodejs";

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function values(request: Request, rawCollectionId: string) {
  const collectionId = positiveId(rawCollectionId);
  let body: { gameId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // The validation response below covers an empty body.
  }
  return { collectionId, gameId: positiveId(body.gameId) };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await values(request, (await params).id);
  if (parsed.collectionId == null || parsed.gameId == null) {
    return Response.json({ error: "invalid_membership" }, { status: 400 });
  }
  const result = await setCollectionMembership(parsed.collectionId, parsed.gameId, true);
  if (result === "missing") return Response.json({ error: "game_or_collection_not_found" }, { status: 404 });
  return Response.json({ included: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await values(request, (await params).id);
  if (parsed.collectionId == null || parsed.gameId == null) {
    return Response.json({ error: "invalid_membership" }, { status: 400 });
  }
  const result = await setCollectionMembership(parsed.collectionId, parsed.gameId, false);
  if (result === "missing") return Response.json({ error: "game_or_collection_not_found" }, { status: 404 });
  return Response.json({ included: false });
}
