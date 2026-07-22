import { createCollection, listCollections } from "@/server/data/collections";
import { isDemoMode } from "@/server/demo-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function color(value: unknown): string {
  const candidate = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : "#a12222";
}

export async function GET() {
  return Response.json({ collections: await listCollections() });
}

export async function POST(request: Request) {
  let body: { name?: unknown; description?: unknown; color?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = cleanText(body.name, 60);
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });
  const collection = await createCollection({
    name,
    description: cleanText(body.description, 240),
    color: color(body.color),
  });
  if (collection === "duplicate") {
    return Response.json({ error: "duplicate_collection" }, { status: 409 });
  }
  return Response.json({ collection, demo: isDemoMode() }, { status: 201 });
}
