import { deleteCollection, updateCollection } from "@/server/repositories/collections";

export const runtime = "nodejs";

function idFrom(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (id == null) return Response.json({ error: "invalid_collection_id" }, { status: 400 });
  let body: { name?: unknown; description?: unknown; color?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = cleanText(body.name, 60);
  const candidateColor = String(body.color ?? "").trim();
  if (!name || !/^#[0-9a-f]{6}$/i.test(candidateColor)) {
    return Response.json({ error: "invalid_collection" }, { status: 400 });
  }
  const collection = await updateCollection(id, {
    name,
    description: cleanText(body.description, 240),
    color: candidateColor,
  });
  if (collection === "missing") return Response.json({ error: "collection_not_found" }, { status: 404 });
  if (collection === "duplicate") return Response.json({ error: "duplicate_collection" }, { status: 409 });
  return Response.json({ collection });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (id == null) return Response.json({ error: "invalid_collection_id" }, { status: 400 });
  if (!await deleteCollection(id)) return Response.json({ error: "collection_not_found" }, { status: 404 });
  return Response.json({ deleted: true });
}
