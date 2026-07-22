export async function POST() {
  return Response.json({
    error: "demo_import_unavailable",
    detail: "The hosted demo uses a fixed, sanitized archive. Import works in a local OpenFile installation.",
  }, { status: 409 });
}
