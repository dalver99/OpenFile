import { after } from "next/server";
import { getPuzzleSolution, recordPuzzleProgress } from "@/server/data/puzzles";

// POST /api/attempt
// body: { puzzleId: number, moveUci?: string, reveal?: boolean }
// Verifies the move server-side (solution never leaves the server until solved
// or revealed) and records the result in puzzle_progress.
export async function POST(request: Request) {
  let body: { puzzleId?: number; moveUci?: string; reveal?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const puzzleId = Number(body.puzzleId);
  if (!Number.isInteger(puzzleId)) {
    return Response.json({ error: "invalid_puzzle_id" }, { status: 400 });
  }

  const move = String(body.moveUci ?? "").trim().toLowerCase();
  const solution = await getPuzzleSolution(puzzleId);
  if (!solution) {
    return Response.json({ error: "puzzle_not_found" }, { status: 404 });
  }
  const revealed = Boolean(body.reveal);
  const correct = !revealed && move === solution.solution_uci.toLowerCase();
  after(async () => {
    try {
      await recordPuzzleProgress(
        puzzleId,
        revealed ? "revealed" : correct ? "solved" : "attempt",
      );
    } catch (error) {
      console.error("Could not persist puzzle progress", error);
    }
  });

  if (revealed) {
    return Response.json({
      correct: false,
      revealed: true,
      solutionUci: solution.solution_uci,
      solutionSan: solution.solution_san,
      line: solution.solution_line_uci,
    });
  }

  return Response.json({
    correct,
    revealed: false,
    // Only disclose the solution once the puzzle is actually solved.
    solutionUci: correct ? solution.solution_uci : null,
    solutionSan: correct ? solution.solution_san : null,
    line: correct ? solution.solution_line_uci : null,
  });
}
