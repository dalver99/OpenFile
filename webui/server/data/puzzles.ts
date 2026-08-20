import "server-only";

import { demoPuzzles, demoPuzzleSolution, type PuzzleSolution } from "@/server/demo/data";

export type { PuzzleSolution };

export async function listPuzzles(limit = 100) {
  return demoPuzzles(limit);
}

export async function getPuzzleSolution(id: number): Promise<PuzzleSolution | null> {
  return demoPuzzleSolution(id);
}

export async function recordPuzzleProgress(id: number, outcome: "solved" | "revealed" | "attempt") {
  void id;
  void outcome;
}
