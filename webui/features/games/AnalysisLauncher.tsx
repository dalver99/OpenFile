"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = { analyzed: boolean; status: string | null; detail: string | null };

const phaseLabels: Record<string, string> = {
  web_review_queued: "Queued on this Mac",
  engine_starting: "Starting Stockfish",
  analyzing_positions: "Analyzing game positions",
  saving_review: "Saving move scores and comments",
};

export default function AnalysisLauncher({ gameId, initialStatus }: { gameId: number; initialStatus: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<Status>({ analyzed: false, status: initialStatus, detail: null });
  const [seconds, setSeconds] = useState(0);

  const start = useCallback(async () => {
    setState((current) => ({ ...current, status: "selected", detail: null }));
    const response = await fetch(`/api/games/${gameId}/analyze`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setState({ analyzed: false, status: "failed", detail: data.error ?? "Could not start analysis." });
    }
  }, [gameId]);

  useEffect(() => {
    if (!started.current && initialStatus !== "analyzing") {
      started.current = true;
      void start();
    }
  }, [initialStatus, start]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      setSeconds((value) => value + 2);
      try {
        const response = await fetch(`/api/games/${gameId}/analyze`, { cache: "no-store" });
        const data = await response.json();
        setState(data);
        if (data.analyzed) {
          window.clearInterval(timer);
          router.refresh();
        }
      } catch {
        // A later poll can recover from a transient network interruption.
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [gameId, router]);

  const failed = state.status === "failed";
  const phase = phaseLabels[state.detail ?? ""] ??
    (state.status === "selected" ? "Queued on this Mac" : "Analysis worker is running");
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:p-12">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${failed ? "bg-rose-100 text-rose-600" : "bg-brand-100 text-brand-700"}`}>
        <span className={failed ? "text-2xl" : "text-2xl animate-pulse"}>{failed ? "!" : "♞"}</span>
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
        {failed ? "Analysis stopped" : "Reviewing every move"}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">
        {failed
          ? state.detail ?? "The engine could not finish this game."
          : "Stockfish is comparing each move with the strongest candidates. A typical game takes a few minutes, and this page will update automatically."}
      </p>
      {!failed ? (
        <div className="mt-7">
          <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
            <div className="h-full w-2/5 animate-[review-progress_2.2s_ease-in-out_infinite] rounded-full bg-brand-500" />
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
            {phase} · {seconds}s elapsed
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { started.current = true; void start(); }}
          className="mt-7 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
        >
          Try analysis again
        </button>
      )}
    </div>
  );
}
