export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    available: false,
    enabled: false,
    configured_enabled: false,
    installed: false,
    provider: null,
    platform: "Vercel demo",
    schedule: {
      preset: "puzzles",
      frequency: "daily",
      hour: 9,
      weekday: 0,
      analyze_count: 2,
      puzzle_count: 2,
    },
    next_run_at: null,
    last_run: null,
    log: "",
    operations_enabled: false,
    demo: true,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  return Response.json({ error: "demo_automation_unavailable" }, { status: 409 });
}
