import "server-only";

/** This branch is deliberately demo-only; main owns the local application path. */
export function isDemoMode(): boolean {
  return true;
}

export const demoCapabilities = {
  sync: "simulated",
  import: "unavailable",
  gameAnalysis: "unavailable",
  positionAnalysis: "unavailable",
  puzzleTraining: "interactive",
  puzzleGeneration: "unavailable",
  favorites: "session-only",
  collections: "session-only",
  sidelines: "session-only",
  automation: "preview-only",
} as const;
