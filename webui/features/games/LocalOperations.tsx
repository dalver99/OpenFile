"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Action = "ingest" | "analyze";
type Operation = {
  action: Action;
  status: "idle" | "running" | "complete" | "failed";
  message: string;
  output: string;
};
type State = { enabled: boolean; operations: Record<Action, Operation> };

export default function LocalOperations() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/local-operations", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data) setState(data);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!state || !Object.values(state.operations).some((operation) => operation.status === "running")) return;
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/local-operations", { cache: "no-store" });
      if (!response.ok) return;
      const next: State = await response.json();
      setState(next);
      if (!Object.values(next.operations).some((operation) => operation.status === "running")) {
        router.refresh();
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [router, state]);

  async function run(action: Action) {
    const response = await fetch("/api/local-operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    if (data.operation) {
      setState((current) => current ? {
        ...current,
        operations: { ...current.operations, [action]: data.operation },
      } : current);
    }
  }

  const ingest = state?.operations.ingest;
  const analyze = state?.operations.analyze;
  const active = ingest?.status === "running" ? ingest : analyze?.status === "running" ? analyze : null;
  const latest = active ?? ([ingest, analyze].find((operation) => operation?.status === "failed") ?? null);

  return (
    <section className="mb-6 overflow-hidden rounded-2xl bg-stone-900 text-white shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${active ? "animate-pulse bg-emerald-400" : "bg-emerald-500"}`} />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">On this Mac</p>
          </div>
          <h2 className="mt-1 font-semibold">Local chess pipeline</h2>
          <p className={`mt-1 text-xs ${latest?.status === "failed" ? "text-rose-300" : "text-stone-400"}`}>
            {latest?.message ?? "Sync games or review one pending game with your local Stockfish 18 engine."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => run("ingest")}
            disabled={!state?.enabled || ingest?.status === "running"}
            className="rounded-xl border border-stone-600 px-4 py-2.5 text-sm font-semibold transition hover:border-stone-400 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ingest?.status === "running" ? "Syncing…" : "Sync games"}
          </button>
          <button
            type="button"
            onClick={() => run("analyze")}
            disabled={!state?.enabled || analyze?.status === "running"}
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-stone-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyze?.status === "running" ? "Analyzing…" : "Analyze next game"}
          </button>
        </div>
      </div>
      <div className="border-t border-stone-800 px-5 py-2 text-[11px] text-stone-500">
        Sync performs a live Chess.com refresh. Analysis runs one game per click with adaptive Stockfish depth.
      </div>
    </section>
  );
}
