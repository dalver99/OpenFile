"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "queued" | "running" | "failed";

export default function ReanalyzeButton({ gameId }: { gameId: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (phase !== "queued" && phase !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/games/${gameId}/analyze`, { cache: "no-store" });
        const data = await response.json();
        if (data.status === "failed") {
          setPhase("failed");
        } else if (data.status === "analyzing") {
          setPhase("running");
        } else if (data.status === "analyzed") {
          window.clearInterval(timer);
          setPhase("idle");
          router.refresh();
        }
      } catch {
        // A later poll can recover from a transient local-server interruption.
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [gameId, phase, router]);

  async function refreshAnalysis() {
    setPhase("queued");
    try {
      const response = await fetch(`/api/games/${gameId}/analyze?force=1`, { method: "POST" });
      if (!response.ok) setPhase("failed");
    } catch {
      setPhase("failed");
    }
  }

  const label = phase === "queued"
    ? "Queued…"
    : phase === "running"
      ? "Analyzing…"
      : phase === "failed"
        ? "Retry analysis"
        : "Refresh analysis";

  return (
    <button
      type="button"
      onClick={() => void refreshAnalysis()}
      disabled={phase === "queued" || phase === "running"}
      className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-600 shadow-sm transition hover:border-teal-400 hover:text-teal-700 disabled:cursor-wait disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
      title="Run this game again with the current Stockfish and move-label rules"
    >
      {label}
    </button>
  );
}
