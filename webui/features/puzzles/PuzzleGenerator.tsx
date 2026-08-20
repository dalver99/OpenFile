"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type GenerateOperation = {
  status: "idle" | "running" | "complete" | "failed" | "cancelled";
  message: string;
  total?: number;
  completed?: number;
};

export default function PuzzleGenerator({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [count, setCount] = useState(3);
  const [enabled, setEnabled] = useState(true);
  const [operation, setOperation] = useState<GenerateOperation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/local-operations", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    setEnabled(Boolean(data.enabled));
    const next = data.operations?.generate as GenerateOperation | undefined;
    if (next) setOperation(next);
    return next ?? null;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (operation?.status !== "running") return;
    const timer = window.setInterval(async () => {
      const next = await load();
      if (next && next.status !== "running") router.refresh();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [load, operation?.status, router]);

  async function generate() {
    setError(null);
    try {
      const response = await fetch("/api/local-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", count }),
      });
      const data = await response.json();
      if (!response.ok && !data.operation) throw new Error(data.error ?? "Could not start puzzle generation.");
      setOperation(data.operation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start puzzle generation.");
    }
  }

  const running = operation?.status === "running";
  const completed = operation?.completed ?? 0;
  const total = operation?.total ?? count;

  if (compact) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-stone-900 dark:text-stone-50">Generate more puzzles</p>
            <p className="mt-0.5 text-xs text-stone-500">Check reviewed games for another useful training position.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-500">
              Check
              <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={running} className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs font-bold text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {[1, 3, 5, 10].map((value) => <option key={value} value={value}>{value} games</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void generate()} disabled={!enabled || running} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-stone-300 dark:disabled:bg-stone-700">
              {running ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
        {running ? (
          <div className="mt-3">
            <div className="flex justify-between text-[11px] font-semibold text-stone-500"><span>{operation.message}</span><span>{completed}/{total}</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full bg-brand-700 transition-[width] duration-500" style={{ width: `${Math.max(5, (completed / Math.max(1, total)) * 100)}%` }} /></div>
          </div>
        ) : operation && operation.status !== "idle" ? <p className={`mt-3 text-xs font-semibold ${operation.status === "complete" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>{operation.message}</p> : null}
        {error ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
        {!enabled ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Local operations are disabled. Run OpenFile Doctor, then restart the web UI.</p> : null}
      </section>
    );
  }

  return (
    <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-center shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:p-10">
      <div className="text-4xl">♙</div>
      <h2 className="mt-4 text-xl font-black text-stone-900 dark:text-stone-50">Your puzzle queue is empty</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">OpenFile can inspect reviewed games on this computer and turn suitable mistakes into training positions.</p>
      <div className="mx-auto mt-5 flex max-w-sm flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
          Games to check
          <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={running} className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 font-bold text-stone-800 dark:border-stone-600 dark:bg-stone-900 dark:text-white">
            {[1, 3, 5, 10].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void generate()} disabled={!enabled || running} className="rounded-xl bg-brand-700 px-5 py-3 text-sm font-black text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-stone-300 dark:disabled:bg-stone-700">
          {running ? "Generating…" : "Generate puzzles"}
        </button>
      </div>
      {running ? (
        <div className="mx-auto mt-4 max-w-sm text-left">
          <div className="flex justify-between text-xs font-semibold text-stone-500"><span>{operation.message}</span><span>{completed}/{total}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full bg-brand-700 transition-[width] duration-500" style={{ width: `${Math.max(5, (completed / Math.max(1, total)) * 100)}%` }} /></div>
        </div>
      ) : operation && operation.status !== "idle" ? <p className={`mx-auto mt-4 max-w-md text-xs font-semibold ${operation.status === "complete" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>{operation.message}</p> : null}
      {error ? <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
      {!enabled ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Local operations are disabled. Run OpenFile Doctor, then restart the web UI.</p> : null}
      <p className="mt-5 text-xs text-stone-400">Only analyzed games are eligible. <Link href="/engine" className="font-bold text-brand-700 hover:underline dark:text-brand-400">Review games in Engine →</Link></p>
    </div>
  );
}
