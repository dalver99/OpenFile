export async function POST() {
  return Response.json({
    error: "demo_analysis_unavailable",
    detail: "Live evaluation requires Stockfish in the local OpenFile app.",
  }, { status: 409 });
}
