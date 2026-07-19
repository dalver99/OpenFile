"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameCard } from "@/domain/games";

type TimeFilter = "all" | "rapid" | "blitz" | "bullet";
type FocusFilter = "recent" | "all" | "losses" | "favorites";
type LiveStatus = { analyzed: boolean; status: string | null; detail: string | null };
type AnalysisOperation = {
  status: "idle" | "running" | "complete" | "failed" | "cancelled";
  message: string;
  total?: number;
  completed?: number;
  failed?: number;
};
type AnalysisOptions = {
  depth: number;
  multipv: number;
  deepDepth: number;
  deepMultipv: number;
  deepMaxMoves: number;
};

const drawResults = new Set([
  "agreed", "stalemate", "repetition", "insufficient", "50move", "timevsinsufficient",
]);

function outcome(game: GameCard): "win" | "draw" | "loss" {
  if (game.result === "win") return "win";
  return drawResults.has(game.result) ? "draw" : "loss";
}

function opponent(game: GameCard): string {
  return game.side === "white" ? game.black_username : game.white_username;
}

function suggestion(game: GameCard): string {
  if (game.is_favorite) return "Saved game · worth a closer look";
  if (outcome(game) === "loss") return "Recent loss · high learning value";
  if (outcome(game) === "draw") return "Look for missed winning chances";
  return "Find a cleaner conversion";
}

function phase(detail: string | null): string {
  if (detail === "web_review_queued") return "Queued";
  if (detail === "engine_starting") return "Starting Stockfish";
  if (detail === "analyzing_positions") return "Reviewing positions";
  if (detail === "saving_review") return "Saving review";
  return "Analyzing";
}

export default function AnalysisQueue({
  candidates,
  totalWaiting,
}: {
  candidates: GameCard[];
  totalWaiting: number;
}) {
  const router = useRouter();
  const initialActive = candidates.find((game) => ["selected", "analyzing"].includes(game.status));
  const [activeId, setActiveId] = useState<number | null>(initialActive?.id ?? null);
  const [live, setLive] = useState<Record<number, LiveStatus>>({});
  const [time, setTime] = useState<TimeFilter>("all");
  const [focus, setFocus] = useState<FocusFilter>("recent");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [operation, setOperation] = useState<AnalysisOperation | null>(null);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>({
    depth: 16,
    multipv: 1,
    deepDepth: 20,
    deepMultipv: 3,
    deepMaxMoves: 12,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/local-operations", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const current = data.operations?.analyze as AnalysisOperation | undefined;
        if (!cancelled && current?.status === "running") setOperation(current);
        if (!cancelled && data.analysisDefaults) {
          setAnalysisOptions(data.analysisDefaults as AnalysisOptions);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (operation?.status !== "running") return;
    const poll = async () => {
      try {
        const response = await fetch("/api/local-operations", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const next = data.operations?.analyze as AnalysisOperation | undefined;
        if (!next) return;
        setOperation(next);
        if (next.status !== "running") router.refresh();
      } catch {
        // The next poll can recover if the local server briefly restarts.
      }
    };
    const timer = window.setInterval(poll, 1_500);
    return () => window.clearInterval(timer);
  }, [operation?.status, router]);

  useEffect(() => {
    if (activeId === null) return;
    const poll = async () => {
      try {
        const response = await fetch(`/api/games/${activeId}/analyze`, { cache: "no-store" });
        if (!response.ok) return;
        const state: LiveStatus = await response.json();
        setLive((current) => ({ ...current, [activeId]: state }));
        if (state.analyzed) {
          setActiveId(null);
          router.refresh();
        } else if (state.status === "failed") {
          setActiveId(null);
          setError(state.detail ?? "Stockfish could not finish that game.");
        }
      } catch {
        // A later poll can recover from a transient local-server interruption.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2_000);
    return () => window.clearInterval(timer);
  }, [activeId, router]);

  const filtered = useMemo(() => {
    const focused = focus === "losses"
        ? candidates.filter((game) => outcome(game) === "loss")
        : focus === "favorites"
          ? candidates.filter((game) => game.is_favorite)
          : candidates;
    const matching = focused
      .filter((game) => time === "all" || game.time_class === time)
      .filter((game) => game.id !== activeId);
    return focus === "recent" ? matching.slice(0, 12) : matching;
  }, [activeId, candidates, focus, time]);

  const active = activeId === null ? null : candidates.find((game) => game.id === activeId) ?? null;
  const batchRunning = operation?.status === "running";
  const engineBusy = batchRunning || activeId !== null;
  const selectable = filtered.filter((game) => !["selected", "analyzing"].includes(game.status));
  const selectedGames = candidates.filter((game) => selected.has(game.id));
  const allVisibleSelected = selectable.length > 0 && selectable.every((game) => selected.has(game.id));

  function toggle(gameId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const game of selectable) {
        if (allVisibleSelected) next.delete(game.id);
        else next.add(game.id);
      }
      return next;
    });
  }

  async function analyzeSelected() {
    const gameIds = selectedGames.map((game) => game.id).slice(0, 20);
    if (!gameIds.length) return;
    setError(null);
    try {
      const response = await fetch("/api/local-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze", gameIds, analysisOptions }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error === "no_games_queued"
          ? "Those games are already reviewed or in progress."
            : data.error === "analysis_in_progress"
              ? "Another game is already being analyzed. This queue can start when it finishes."
            : data.error === "local_operations_disabled"
            ? "Local analysis is disabled. Run OpenFile Doctor to check the setup."
            : "Could not start the analysis queue.");
        if (data.operation) setOperation(data.operation as AnalysisOperation);
        return;
      }
      setSelected(new Set());
      setOperation(data.operation as AnalysisOperation);
    } catch {
      setError("Could not reach the local analysis worker.");
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden [&::-webkit-details-marker]:hidden">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">Analysis queue</p>
            <h2 className="mt-0.5 text-base font-black text-stone-900 dark:text-stone-50">Choose games to review</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-stone-500">{totalWaiting} waiting</span>
            <span className="flex h-8 w-8 origin-center items-center justify-center rounded-lg bg-stone-100 text-base leading-none text-stone-500 transition-transform group-open:rotate-180 dark:bg-stone-800" aria-hidden="true">⌄</span>
          </div>
        </summary>

      <div className="border-t border-stone-100 p-4 dark:border-stone-800">
        <p className="text-xs leading-5 text-stone-500">Nothing starts until you select it.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Speed
            <select value={time} onChange={(event) => setTime(event.target.value as TimeFilter)} className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-700 outline-none focus:border-brand-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
              <option value="all">All games</option>
              <option value="rapid">Rapid</option>
              <option value="blitz">Blitz</option>
              <option value="bullet">Bullet</option>
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Show
            <select value={focus} onChange={(event) => setFocus(event.target.value as FocusFilter)} className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-700 outline-none focus:border-brand-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
              <option value="recent">Recent</option>
              <option value="all">All waiting</option>
              <option value="losses">Losses</option>
              <option value="favorites">Favorites</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-800/70">
          <button type="button" onClick={toggleVisible} disabled={!selectable.length} aria-pressed={allVisibleSelected} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 transition hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
            {allVisibleSelected ? "Clear visible" : `Select visible (${selectable.length})`}
          </button>
          <button type="button" onClick={analyzeSelected} disabled={!selectedGames.length || engineBusy} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-stone-300 dark:disabled:bg-stone-700">
            {batchRunning ? "Analysis running…" : `Analyze ${selectedGames.length || "selected"}`}
          </button>
        </div>

        <details className="mt-3 rounded-xl border border-stone-200 dark:border-stone-700">
          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-stone-500">Analysis settings</summary>
          <div className="grid grid-cols-2 gap-2 border-t border-stone-100 p-3 dark:border-stone-800">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">First pass depth
              <select value={analysisOptions.depth} onChange={(event) => setAnalysisOptions((current) => ({ ...current, depth: Number(event.target.value), deepDepth: Math.max(current.deepDepth, Number(event.target.value)) }))} disabled={engineBusy} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {[8, 10, 12, 14, 16, 18, 20, 22, 24].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Candidate lines
              <select value={analysisOptions.multipv} onChange={(event) => setAnalysisOptions((current) => ({ ...current, multipv: Number(event.target.value) }))} disabled={engineBusy} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Critical depth
              <select value={analysisOptions.deepDepth} onChange={(event) => setAnalysisOptions((current) => ({ ...current, deepDepth: Number(event.target.value) }))} disabled={engineBusy} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {[10, 12, 14, 16, 18, 20, 22, 24, 26].filter((value) => value >= analysisOptions.depth).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Critical lines
              <select value={analysisOptions.deepMultipv} onChange={(event) => setAnalysisOptions((current) => ({ ...current, deepMultipv: Number(event.target.value) }))} disabled={engineBusy} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-[10px] font-semibold uppercase tracking-wide text-stone-400">Maximum critical positions
              <select value={analysisOptions.deepMaxMoves} onChange={(event) => setAnalysisOptions((current) => ({ ...current, deepMaxMoves: Number(event.target.value) }))} disabled={engineBusy} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {[...new Set([0, 6, 12, 18, 24, 30, analysisOptions.deepMaxMoves])]
                  .sort((left, right) => left - right)
                  .map((value) => <option key={value} value={value}>{value === 0 ? "Off" : value}</option>)}
              </select>
            </label>
            <p className="col-span-2 text-[10px] leading-4 text-stone-400">Higher depth, more lines, and more critical positions improve detail but increase analysis time.</p>
          </div>
        </details>
      </div>

      {batchRunning && operation ? (
        <div className="border-b border-stone-100 bg-brand-50/70 p-4 dark:border-stone-800 dark:bg-brand-950/20">
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-brand-800 dark:text-brand-300">
            <span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />{operation.message}</span>
            <span>{operation.completed ?? 0}/{operation.total ?? selectedGames.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-950">
            <div className="h-full rounded-full bg-brand-700 transition-[width] duration-500" style={{ width: `${Math.max(4, ((operation.completed ?? 0) / Math.max(1, operation.total ?? 1)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-stone-500">Stockfish runs these one at a time to keep your computer responsive.</p>
        </div>
      ) : active ? (
        <div className="border-b border-stone-100 bg-brand-50/70 p-4 dark:border-stone-800 dark:bg-brand-950/20">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold text-brand-800 dark:text-brand-300"><span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />{phase(live[active.id]?.detail ?? active.status_detail)}</p>
              <p className="mt-1 truncate text-sm font-bold text-stone-900 dark:text-stone-100">vs {opponent(active)}</p>
            </div>
            <Link href={`/games/${active.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-800 hover:border-brand-400 dark:border-brand-900 dark:bg-stone-900 dark:text-brand-300">Open status</Link>
          </div>
        </div>
      ) : (
        <div className="border-y border-stone-100 bg-stone-50/70 px-4 py-3 dark:border-stone-800 dark:bg-stone-800/35">
          <p className="flex items-center gap-2 text-xs font-semibold text-stone-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />Engine idle · select games to begin</p>
        </div>
      )}

      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {filtered.length ? filtered.map((game) => {
          const result = outcome(game);
          const unavailable = ["selected", "analyzing"].includes(game.status);
          return (
            <article key={game.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <label className={`flex min-w-0 flex-1 items-center gap-3 ${unavailable ? "cursor-default" : "cursor-pointer"}`}>
                  <input type="checkbox" checked={selected.has(game.id)} onChange={() => toggle(game.id)} disabled={unavailable} className="h-4 w-4 shrink-0 accent-brand-700" aria-label={`Select game against ${opponent(game)}`} />
                  <span className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${result === "win" ? "bg-emerald-500" : result === "loss" ? "bg-rose-500" : "bg-stone-400"}`} />
                    <p className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">vs {opponent(game)}</p>
                    <span className="text-[10px] font-semibold uppercase text-stone-400">{game.time_class ?? "game"}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-stone-500">{unavailable ? "Analysis in progress" : suggestion(game)}</p>
                  </span>
                </label>
                <Link href={`/games/${game.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-stone-200 px-2.5 py-2 text-xs font-bold text-stone-500 hover:border-brand-400 hover:text-brand-700 dark:border-stone-700 dark:text-stone-300" aria-label={`Open game against ${opponent(game)}`}>Open</Link>
              </div>
            </article>
          );
        }) : (
          <div className="p-8 text-center text-sm text-stone-500">No unanalyzed games match these filters.</div>
        )}
      </div>

      {operation && operation.status !== "running" ? <p className={`border-t px-4 py-3 text-xs font-semibold ${operation.status === "complete" ? "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300"}`}>{operation.message}</p> : null}
      {error ? <p className="border-t border-rose-100 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-950 dark:bg-rose-950/30 dark:text-rose-300">{error}</p> : null}
      <Link href="/games?time=all&review=waiting" className="block border-t border-stone-100 px-4 py-3 text-center text-xs font-bold text-stone-500 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-800 dark:hover:bg-stone-800 dark:hover:text-white">Browse every game needing review →</Link>
      </details>
    </section>
  );
}
