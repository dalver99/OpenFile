"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Status = { analyzed: boolean; status: string | null; detail: string | null };

const phaseLabels: Record<string, string> = {
  web_review_queued: "Queued on this Mac",
  engine_starting: "Starting Stockfish",
  analyzing_positions: "Analyzing game positions",
  saving_review: "Saving move scores and comments",
};

export default function AnalysisLauncher({ gameId, initialStatus, demo = false }: { gameId: number; initialStatus: string; demo?: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<Status>({ analyzed: false, status: initialStatus, detail: null });
  const [seconds, setSeconds] = useState(0);

  const start = useCallback(async () => {
    if (demo) return;
    setState((current) => ({ ...current, status: "selected", detail: null }));
    const response = await fetch(`/api/games/${gameId}/analyze`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setState({ analyzed: false, status: "failed", detail: data.error ?? "Could not start analysis." });
    }
  }, [demo, gameId]);

  useEffect(() => {
    if (!demo && !started.current && initialStatus !== "analyzing") {
      started.current = true;
      void start();
    }
  }, [demo, initialStatus, start]);

  useEffect(() => {
    if (demo) return;
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
  }, [demo, gameId, router]);

  if (demo) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm dark:border-amber-900 dark:bg-amber-950/30 sm:p-12">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-100 text-2xl text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">♞</div>
        <h1 className="mt-6 text-2xl font-bold text-stone-900 dark:text-stone-50">Analysis needs the desktop app</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-stone-600 dark:text-stone-300">This game is intentionally left unanalyzed to demonstrate the queue. The hosted demo cannot start a local Stockfish process or modify the archive.</p>
        <Link href="/games/207" className="mt-6 inline-flex rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800">Open a completed review</Link>
      </div>
    );
  }

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
