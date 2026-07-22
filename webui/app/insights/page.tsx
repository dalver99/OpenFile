import Link from "next/link";
import type { InsightSlice } from "@/domain/insights";
import { getPlayerInsights } from "@/server/data/insights";

export const dynamic = "force-dynamic";

function ErrorRate({ slice }: { slice: InsightSlice }) {
  const rate = slice.moves ? Math.round((slice.severeErrors / slice.moves) * 100) : 0;
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
      <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.max(rate, slice.severeErrors ? 4 : 0)}%` }} />
    </div>
  );
}

function EmptyInsights() {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="text-4xl">♟</div>
      <h2 className="mt-4 text-xl font-black text-stone-900 dark:text-stone-50">No reviewed games yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">Analyze a few games first. This page will then find recurring phase, opening, time-control, and clock-pressure patterns.</p>
      <Link href="/games" className="mt-5 inline-flex rounded-xl bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800">Choose games to analyze</Link>
    </div>
  );
}

export default async function InsightsPage() {
  let insights: Awaited<ReturnType<typeof getPlayerInsights>> | null = null;
  let error: string | null = null;
  try {
    insights = await getPlayerInsights();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load insights.";
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-400">Patterns from your reviews</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">Insights</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">A player-specific view of where your decisions lose value. These are engine signals, not verdicts—the sample size is shown so you can judge how much to trust each pattern.</p>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">Could not load insights: {error}</div>
      ) : insights && insights.reviewedGames ? (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Insight summary">
            {[
              [insights.reviewedGames, "Reviewed games"],
              [`${insights.averageAccuracy}%`, "Average review score"],
              [insights.brilliantMoves, "Brilliant moves"],
              [insights.severeErrors, "Mistakes + blunders"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <strong className="block text-2xl font-black text-stone-900 dark:text-stone-50">{value}</strong>
                <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</span>
              </div>
            ))}
          </section>

          {insights.brilliancies.length ? (
            <section className="rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-6 shadow-sm dark:border-teal-900 dark:from-teal-950/40 dark:to-stone-900">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">OpenFile Brilliant</p>
                  <h2 className="mt-1 text-xl font-black text-stone-900 dark:text-stone-50">Your brilliancy reel</h2>
                </div>
                <p className="text-xs text-stone-500">Verified best-move material sacrifices</p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {insights.brilliancies.map((move) => (
                  <Link key={`${move.gameId}-${move.moveNumber}-${move.side}`} href={`/games/${move.gameId}`} className="group flex items-center gap-4 rounded-2xl border border-teal-200 bg-white/90 p-4 transition hover:-translate-y-0.5 hover:shadow-md dark:border-teal-900 dark:bg-stone-900/90">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-500 text-sm font-black text-white shadow-sm">!!</span>
                    <span className="min-w-0">
                      <strong className="block text-lg text-stone-900 group-hover:text-teal-700 dark:text-stone-50 dark:group-hover:text-teal-300">{move.moveNumber}{move.side === "black" ? "…" : "."} {move.san}</strong>
                      <span className="block truncate text-xs text-stone-500">{move.opening} · {move.playedAt ?? "Unknown date"}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-brand-200 bg-brand-50/70 p-6 dark:border-brand-900 dark:bg-brand-950/30">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">What to work on next</p>
              <h2 className="mt-2 text-xl font-black text-stone-900 dark:text-stone-50">{insights.focus.title}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-300">{insights.focus.detail}</p>
              {insights.focus.href ? <Link href={insights.focus.href} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-800 hover:underline dark:text-brand-300">Open a relevant review <span aria-hidden>→</span></Link> : null}
            </div>

            <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400">On the clock</p>
                  <h2 className="mt-2 text-lg font-black text-stone-900 dark:text-stone-50">Clock data is ready</h2>
                </div>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">{insights.clock.archiveGamesWithClock}/{insights.clock.archiveGames} games</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-stone-500">{insights.clock.timePressureSevereErrors} of {insights.clock.severeErrors} severe errors in reviewed clock games happened with 10% or less of the starting time remaining.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/70"><strong className="block text-lg text-stone-900 dark:text-stone-50">{insights.clock.averageLossWithTime ?? "—"}</strong><span className="text-xs text-stone-500">Avg CPL with time</span></div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/70"><strong className="block text-lg text-stone-900 dark:text-stone-50">{insights.clock.averageLossUnderPressure ?? "—"}</strong><span className="text-xs text-stone-500">Avg CPL under pressure</span></div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-500">Decision quality</p><h2 className="mt-1 text-xl font-black text-stone-900 dark:text-stone-50">Where points leak</h2></div>
              <p className="text-xs text-stone-500">Phase is estimated from move number: 1–10, 11–30, 31+</p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {insights.phase.map((slice) => (
                <article key={slice.label} className="rounded-2xl border border-stone-200 p-4 dark:border-stone-700">
                  <div className="flex items-center justify-between"><h3 className="font-black text-stone-900 dark:text-stone-50">{slice.label}</h3><span className="text-sm font-bold text-brand-700 dark:text-brand-400">{slice.accuracy}%</span></div>
                  <p className="mt-2 text-sm text-stone-500">{slice.averageLoss} avg CPL · {slice.severeErrors} severe errors</p>
                  <ErrorRate slice={slice} />
                  <p className="mt-2 text-xs text-stone-400">{slice.moves} moves across {slice.games} games</p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-xl font-black text-stone-900 dark:text-stone-50">By time control</h2>
              <div className="mt-4 space-y-3">
                {insights.timeClasses.map((slice) => (
                  <div key={slice.label} className="flex items-center justify-between gap-4 rounded-xl bg-stone-50 px-4 py-3 dark:bg-stone-800/70">
                    <div><strong className="text-sm text-stone-900 dark:text-stone-50">{slice.label}</strong><p className="text-xs text-stone-500">{slice.games} games · {slice.severeErrors} severe errors</p></div>
                    <div className="text-right"><strong className="text-lg text-stone-900 dark:text-stone-50">{slice.accuracy}%</strong><p className="text-xs text-stone-500">{slice.averageLoss} CPL</p></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-xl font-black text-stone-900 dark:text-stone-50">Recent review trend</h2>
              <p className="mt-1 text-xs text-stone-500">Oldest to newest · last {insights.trend.length} reviewed games</p>
              <div className="mt-5 flex h-40 items-end gap-1.5 border-b border-stone-200 dark:border-stone-700">
                {insights.trend.map((game, index) => (
                  <Link key={`${game.id}-${game.playedAt ?? "unknown"}-${index}`} href={`/games/${game.id}`} className="group flex h-full min-w-0 flex-1 items-end" title={`${game.playedAt ?? "Unknown date"}: ${game.accuracy}%`}>
                    <span className={`block w-full rounded-t transition-opacity group-hover:opacity-70 ${game.result === "win" ? "bg-brand-500" : game.result === "draw" ? "bg-sky-400" : "bg-orange-400"}`} style={{ height: `${Math.max(8, game.accuracy)}%` }} />
                  </Link>
                ))}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-stone-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-500" />Win</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />Draw</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-400" />Loss</span></div>
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-500">Repeated positions first</p><h2 className="mt-1 text-xl font-black text-stone-900 dark:text-stone-50">Opening watchlist</h2></div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-stone-400"><tr><th className="pb-3 font-semibold">Opening</th><th className="pb-3 font-semibold">Games</th><th className="pb-3 font-semibold">Score</th><th className="pb-3 font-semibold">Review score</th><th className="pb-3 text-right font-semibold">Severe errors</th></tr></thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {insights.openings.map((opening) => (
                    <tr key={opening.label}><td className="max-w-sm py-3 pr-4 font-semibold text-stone-900 dark:text-stone-50">{opening.label}</td><td className="py-3 text-stone-500">{opening.games}</td><td className="py-3 text-stone-500">{opening.winRate}%</td><td className="py-3 font-bold text-brand-700 dark:text-brand-400">{opening.accuracy}%</td><td className="py-3 text-right text-stone-500">{opening.severeErrors}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : <EmptyInsights />}
    </main>
  );
}
