"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { messages } from "@/i18n/messages";

type GameText = typeof messages.en.games | typeof messages.ko.games;
type SyncRun = {
  id: number;
  username: string;
  status: "running" | "complete" | "failed" | "cancelled";
  phase: string;
  archiveMonths: number;
  maxGames: number;
  refreshExisting: boolean;
  archivesTotal: number;
  archivesDone: number;
  checked: number;
  added: number;
  existing: number;
  processed: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  timeClasses: Record<string, number>;
};
type State = {
  enabled: boolean;
  syncRun: SyncRun | null;
  syncDefaults: { username: string | null; archiveMonths: number; maxGames: number };
};

const phases = ["connecting", "fetching", "comparing", "saving"] as const;
const labels = { connecting: "Connect", fetching: "Fetch", comparing: "Compare", saving: "Save" };

function parseTimestamp(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function readableTime(value: string | null): string {
  if (!value) return "Never synced";
  const date = parseTimestamp(value);
  if (Number.isNaN(date.valueOf())) return value;
  const seconds = Math.round((Date.now() - date.valueOf()) / 1_000);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function duration(run: SyncRun): string | null {
  if (!run.finishedAt) return null;
  const seconds = Math.max(0, Math.round((parseTimestamp(run.finishedAt).valueOf() - parseTimestamp(run.startedAt).valueOf()) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function progressDetail(run: SyncRun): string {
  if (run.phase === "fetching") return run.archivesTotal
    ? `${run.archivesDone}/${run.archivesTotal} monthly archives downloaded`
    : "Finding recent Chess.com archives";
  if (run.phase === "comparing") return `Comparing ${run.checked} games with your library`;
  if (run.phase === "saving") return `Saving ${run.processed}/${run.refreshExisting ? run.checked : run.added} games`;
  return "Connecting to Chess.com";
}

function Progress({ run }: { run: SyncRun }) {
  const current = Math.max(0, phases.indexOf(run.phase as (typeof phases)[number]));
  return (
    <div className="grid grid-cols-4 gap-1.5" aria-label={`Sync phase: ${run.phase}`}>
      {phases.map((phaseName, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <div key={phaseName}>
            <div className={`h-1 rounded-full ${done ? "bg-stone-700 dark:bg-stone-300" : active ? "animate-pulse bg-brand-600" : "bg-stone-200 dark:bg-stone-700"}`} />
            <p className={`mt-1 text-[9px] font-semibold uppercase tracking-wide ${done || active ? "text-stone-600 dark:text-stone-300" : "text-stone-400 dark:text-stone-600"}`}>{labels[phaseName]}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function LocalOperations({ text, demo = false }: { text: GameText; demo?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [archiveMonths, setArchiveMonths] = useState(1);
  const [maxGames, setMaxGames] = useState(100);
  const [refreshExisting, setRefreshExisting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const initialized = useRef(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/local-operations", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not read sync status.");
    const next: State = await response.json();
    setState(next);
    if (!initialized.current) {
      setArchiveMonths(next.syncRun?.archiveMonths ?? next.syncDefaults.archiveMonths);
      setMaxGames(next.syncRun?.maxGames ?? next.syncDefaults.maxGames);
      setRefreshExisting(next.syncRun?.refreshExisting ?? false);
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load().catch((error: Error) => setRequestError(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const running = state?.syncRun?.status === "running";
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) router.refresh();
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const timer = window.setInterval(() => load().catch(() => undefined), 1_200);
    return () => window.clearInterval(timer);
  }, [load, router, running]);

  async function syncGames() {
    setRequestError(null);
    const response = await fetch("/api/local-operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ingest", archiveMonths, maxGames, refreshExisting }),
    });
    const data = await response.json();
    if (!response.ok && !data.syncRun) setRequestError(data.error ?? "Could not start synchronization.");
    if (data.syncRun) setState((current) => current ? { ...current, syncRun: data.syncRun } : current);
  }

  async function cancelSync() {
    const response = await fetch("/api/local-operations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ingest" }),
    });
    const data = await response.json();
    if (!response.ok) setRequestError(data.error ?? "Could not cancel synchronization.");
    else setState((current) => current ? { ...current, syncRun: data.syncRun } : current);
  }

  const run = state?.syncRun ?? null;
  const username = run?.username ?? state?.syncDefaults.username;
  const timeClasses = run ? Object.entries(run.timeClasses).sort((a, b) => b[1] - a[1]) : [];

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="p-5">
        {demo ? <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/35 dark:text-amber-200">Demo preview: Check now returns a sample sync result; it does not contact Chess.com.</p> : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-400">Game library</p>
            <h2 className="mt-1 truncate font-bold text-stone-900 dark:text-stone-100">Chess.com sync{username ? ` · @${username}` : ""}</h2>
            <p className="mt-1 text-xs text-stone-500">{run ? `Checked ${readableTime(run.finishedAt ?? run.startedAt)}` : "Bring recent games into OpenFile"}</p>
          </div>
          {running ? (
            <button type="button" onClick={cancelSync} className="shrink-0 rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40">Cancel</button>
          ) : (
            <button type="button" onClick={syncGames} disabled={!state?.enabled} className="shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-700 transition hover:border-stone-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-stone-400">↻ {run ? "Check now" : text.sync}</button>
          )}
        </div>

        {running && run ? (
          <div className="mt-4 rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60">
            <Progress run={run} />
            <p className="mt-3 text-xs font-medium text-stone-600 dark:text-stone-300">{progressDetail(run)}</p>
          </div>
        ) : run?.status === "complete" ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2.5 dark:bg-stone-800/60">
            <div>
              <p className="text-xs font-bold text-stone-800 dark:text-stone-200">{run.added ? `${run.added} new ${run.added === 1 ? "game" : "games"}` : "Library is up to date"}</p>
              <p className="mt-0.5 text-[11px] text-stone-500">{run.checked} checked · {run.existing} already local{duration(run) ? ` · ${duration(run)}` : ""}</p>
            </div>
            {run.added ? <Link href={`/games?time=all&review=waiting&sync=${run.id}`} className="shrink-0 text-xs font-bold text-brand-700 hover:underline dark:text-brand-400">View →</Link> : null}
          </div>
        ) : run ? (
          <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 dark:bg-rose-950/25">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-300">{run.status === "failed" ? "Sync did not finish" : "Sync cancelled"}</p>
            <p className="mt-1 line-clamp-2 text-[11px] text-rose-600/80 dark:text-rose-300/70">{run.error ?? "Try again when ready."}</p>
          </div>
        ) : null}

        {requestError ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{requestError}</p> : null}
        {!state?.enabled && state ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Local operations are disabled.</p> : null}

        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="mt-4 text-xs font-semibold text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">{expanded ? "▾" : "▸"} Sync details & options</button>
        {expanded ? (
          <div className="mt-3 space-y-3 border-t border-stone-100 pt-3 dark:border-stone-800">
            {timeClasses.length ? (
              <div className="flex flex-wrap gap-1.5">
                {timeClasses.map(([timeClass, count]) => <Link key={timeClass} href={`/games?time=${["rapid", "blitz", "bullet"].includes(timeClass) ? timeClass : "all"}&review=waiting&sync=${run?.id}`} className="rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300">{timeClass} {count}</Link>)}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Archives
                <select value={archiveMonths} onChange={(event) => setArchiveMonths(Number(event.target.value))} disabled={running} className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-2 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                  {[1, 2, 3, 6, 12, 24].map((value) => <option key={value} value={value}>{value} {value === 1 ? "month" : "months"}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Game limit
                <select value={maxGames} onChange={(event) => setMaxGames(Number(event.target.value))} disabled={running} className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-2 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                  {[50, 100, 200, 500, 1_000, 2_000].map((value) => <option key={value} value={value}>{value.toLocaleString()}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-start gap-2 text-xs text-stone-500"><input type="checkbox" checked={refreshExisting} onChange={(event) => setRefreshExisting(event.target.checked)} disabled={running} className="mt-0.5 accent-brand-700" /><span><strong className="block text-stone-700 dark:text-stone-200">Refresh existing games</strong>Slower; normally leave this off.</span></label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
