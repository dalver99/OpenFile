"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { messages } from "@/i18n/messages";

type AutomationText = typeof messages.en.automation | typeof messages.ko.automation;
type Preset = "sync" | "review" | "puzzles";
type Frequency = "every_6_hours" | "every_12_hours" | "daily" | "weekly";
type Schedule = {
  preset: Preset;
  frequency: Frequency;
  hour: number;
  weekday: number;
  analyze_count: number;
  puzzle_count: number;
};
type RunState = {
  status?: "running" | "complete" | "failed";
  last_started_at?: string;
  last_finished_at?: string;
  last_error?: string | null;
  last_summary?: { analyzed?: number; puzzles?: number };
};
type AutomationState = {
  available: boolean;
  enabled: boolean;
  configured_enabled: boolean;
  installed: boolean;
  provider: string | null;
  platform: string;
  schedule: Schedule;
  next_run_at: string | null;
  last_run: RunState | null;
  log: string;
  operations_enabled: boolean;
};

function localDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function providerLabel(value: string | null): string {
  if (value === "launchd") return "macOS LaunchAgent";
  if (value === "systemd") return "Linux systemd user timer";
  if (value === "cron") return "Linux user crontab";
  if (value === "task_scheduler") return "Windows Task Scheduler";
  return "Not installed";
}

export default function AutomationSettings({ text, demo = false }: { text: AutomationText; demo?: boolean }) {
  const [state, setState] = useState<AutomationState | null>(null);
  const [form, setForm] = useState<Schedule>({
    preset: "puzzles",
    frequency: "daily",
    hour: 9,
    weekday: 0,
    analyze_count: 2,
    puzzle_count: 2,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/automation", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not read automation status.");
    setState(data);
    if (!initialized.current) {
      setForm(data.schedule);
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load().catch((caught: Error) => setError(caught.message)), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const running = state?.last_run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => load().catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [load, running]);

  async function update(action: "enable" | "disable" | "run") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...form }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update automation.");
      if (action === "run") {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        await load();
      } else {
        setState((current) => current ? { ...current, ...data, operations_enabled: current.operations_enabled } : data);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update automation.");
    } finally {
      setBusy(false);
    }
  }

  const presetOptions: Array<{ value: Preset; title: string; detail: string; icon: string }> = [
    { value: "sync", title: text.syncTitle, detail: text.syncDetail, icon: "↻" },
    { value: "review", title: text.reviewTitle, detail: text.reviewDetail, icon: "♞" },
    { value: "puzzles", title: text.puzzlesTitle, detail: text.puzzlesDetail, icon: "✦" },
  ];
  const frequencyOptions: Array<{ value: Frequency; label: string }> = [
    { value: "every_6_hours", label: text.every6 },
    { value: "every_12_hours", label: text.every12 },
    { value: "daily", label: text.daily },
    { value: "weekly", label: text.weekly },
  ];
  const active = Boolean(state?.enabled);
  const canManage = Boolean(state?.available && state?.operations_enabled);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-400">{text.eyebrow}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">{text.title}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${active ? "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}>{active ? `● ${text.active}` : `○ ${text.off}`}</span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">{text.description}</p>
        {demo ? <p className="mt-4 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-200">Schedule controls are shown as a preview. Browser hosting cannot install launchd, systemd, cron, or Windows Task Scheduler jobs on your computer.</p> : null}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-6">
          <h2 className="text-lg font-black text-stone-900 dark:text-stone-50">{text.routine}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {presetOptions.map((option) => (
              <button key={option.value} type="button" onClick={() => setForm((current) => ({ ...current, preset: option.value }))} className={`rounded-2xl border p-4 text-left transition ${form.preset === option.value ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100 dark:bg-brand-950/35 dark:ring-brand-900" : "border-stone-200 hover:border-stone-400 dark:border-stone-700"}`}>
                <span className={`grid h-9 w-9 place-items-center rounded-xl text-lg ${form.preset === option.value ? "bg-brand-700 text-white" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}>{option.icon}</span>
                <strong className="mt-3 block text-sm text-stone-900 dark:text-stone-50">{option.title}</strong>
                <span className="mt-1 block text-xs leading-5 text-stone-500">{option.detail}</span>
              </button>
            ))}
          </div>

          <div className="mt-7 border-t border-stone-100 pt-6 dark:border-stone-800">
            <h2 className="text-lg font-black text-stone-900 dark:text-stone-50">{text.schedule}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-stone-500">{text.schedule}
                <select value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value as Frequency }))} className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100">
                  {frequencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {(form.frequency === "daily" || form.frequency === "weekly") ? (
                <label className="text-xs font-bold text-stone-500">{text.preferredTime}
                  <select value={form.hour} onChange={(event) => setForm((current) => ({ ...current, hour: Number(event.target.value) }))} className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100">
                    {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" })}</option>)}
                  </select>
                </label>
              ) : <div />}
              {form.frequency === "weekly" ? (
                <label className="text-xs font-bold text-stone-500">{text.preferredDay}
                  <select value={form.weekday} onChange={(event) => setForm((current) => ({ ...current, weekday: Number(event.target.value) }))} className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100">
                    {text.weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select>
                </label>
              ) : null}
              {form.preset !== "sync" ? (
                <label className="text-xs font-bold text-stone-500">{text.reviewsPerRun}
                  <select value={form.analyze_count} onChange={(event) => setForm((current) => ({ ...current, analyze_count: Number(event.target.value) }))} className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100">
                    {[1, 2, 3, 5, 10].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
              ) : null}
              {form.preset === "puzzles" ? (
                <label className="text-xs font-bold text-stone-500">{text.puzzlesPerRun}
                  <select value={form.puzzle_count} onChange={(event) => setForm((current) => ({ ...current, puzzle_count: Number(event.target.value) }))} className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100">
                    {[1, 2, 3, 5, 10].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
          {!state?.available && state ? <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">{text.unavailable}</p> : null}
          {!state?.operations_enabled && state ? <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">{text.disabledOps}</p> : null}
          {state?.configured_enabled && !state.enabled ? <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">{text.repair}</p> : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => void update("enable")} disabled={!canManage || busy} className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-800 disabled:opacity-40">{busy ? "…" : active ? text.save : text.enable}</button>
            {active ? <button type="button" onClick={() => void update("run")} disabled={busy || running} className="rounded-xl border border-teal-300 px-4 py-2.5 text-sm font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-40 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40">{running ? text.running : text.runNow}</button> : null}
            {active ? <button type="button" onClick={() => void update("disable")} disabled={busy || running} className="rounded-xl px-4 py-2.5 text-sm font-bold text-stone-500 hover:text-rose-700 disabled:opacity-40">{text.disable}</button> : null}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <section className="rounded-3xl border border-stone-200 bg-stone-950 p-6 text-white shadow-sm dark:border-stone-700">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-400">{active ? text.active : text.off}</p>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-stone-300">{state?.platform ?? "—"}</span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div><span className="text-xs text-stone-400">{text.nextRun}</span><strong className="mt-1 block text-base">{active ? localDate(state?.next_run_at, "—") : "—"}</strong></div>
              <div><span className="text-xs text-stone-400">{text.lastRun}</span><strong className="mt-1 block text-base">{localDate(state?.last_run?.last_finished_at ?? state?.last_run?.last_started_at, text.never)}</strong>{state?.last_run?.last_summary ? <p className="mt-1 text-xs text-stone-400">{state.last_run.last_summary.analyzed ?? 0} reviews · {state.last_run.last_summary.puzzles ?? 0} puzzles</p> : null}</div>
              <div><span className="text-xs text-stone-400">{text.provider}</span><strong className="mt-1 block text-sm">{providerLabel(state?.provider ?? null)}</strong></div>
            </div>
            {state?.last_run?.status === "failed" ? <p className="mt-4 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200">{text.failed} {state.last_run.last_error}</p> : null}
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">✓</span><div><strong className="text-sm text-stone-900 dark:text-stone-50">{text.webClosed}</strong><p className="mt-1 text-xs leading-5 text-stone-500">{text.powerRequired}</p></div></div>
            {state?.log ? <p className="mt-4 break-all border-t border-stone-100 pt-3 font-mono text-[10px] text-stone-400 dark:border-stone-800"><span className="font-sans font-bold uppercase tracking-wide">{text.logs}: </span>{state.log}</p> : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
