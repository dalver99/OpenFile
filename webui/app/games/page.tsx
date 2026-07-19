import GameList from "@/features/games/GameList";
import LocalOperations from "@/features/games/LocalOperations";
import AnalysisQueue from "@/features/games/AnalysisQueue";
import type { GameArchiveStats, GameCard, GameListFilters, GamePage } from "@/domain/games";
import { getGameArchiveStats, listAnalysisCandidates, listGames } from "@/server/repositories/games";
import { localConfig } from "@/server/database/config";
import { language, messages } from "@/i18n/messages";

export const dynamic = "force-dynamic";

type GamesSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function GamesPage({ searchParams }: { searchParams: GamesSearchParams }) {
  const query = await searchParams;
  const text = messages[language(localConfig().language)].games;
  const requestedTime = first(query.time);
  const requestedReview = first(query.review);
  const requestedFavorite = first(query.favorite);
  const requestedSyncRun = Number.parseInt(first(query.sync), 10);
  const filters: GameListFilters = {
    query: first(query.q).trim().slice(0, 100),
    timeClass: ["rapid", "blitz", "bullet", "all"].includes(requestedTime)
      ? requestedTime as GameListFilters["timeClass"]
      : "rapid",
    review: ["all", "reviewed", "waiting"].includes(requestedReview)
      ? requestedReview as GameListFilters["review"]
      : "waiting",
    favorite: requestedFavorite === "favorites" ? "favorites" : "all",
    syncRunId: Number.isSafeInteger(requestedSyncRun) && requestedSyncRun > 0
      ? requestedSyncRun
      : null,
  };
  const requestedPage = Math.max(1, Number.parseInt(first(query.page), 10) || 1);
  let gamePage: GamePage = { games: [], total: 0, page: 1, pageSize: 40, totalPages: 1 };
  let stats: GameArchiveStats = { total: 0, reviewed: 0, waiting: 0, analyzing: 0 };
  let candidates: GameCard[] = [];
  let error: string | null = null;
  try {
    [gamePage, stats, candidates] = await Promise.all([
      listGames(filters, requestedPage),
      getGameArchiveStats(),
      listAnalysisCandidates(),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load games.";
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">{text.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">{text.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
            {text.description}
          </p>
        </div>
        <div className="flex gap-2 text-center sm:gap-3">
          <div className="min-w-20 rounded-2xl border border-brand-200 bg-brand-50 px-3 py-3 shadow-sm dark:border-brand-900 dark:bg-brand-950/30 sm:min-w-24"><strong className="block text-xl text-brand-800 dark:text-brand-300">{stats.waiting}</strong><span className="text-xs text-brand-700/70 dark:text-brand-300/70">Need review</span></div>
          <div className="min-w-20 rounded-2xl border border-stone-200 bg-white px-3 py-3 shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:min-w-24"><strong className="block text-xl text-stone-900 dark:text-stone-50">{stats.reviewed}</strong><span className="text-xs text-stone-500">{text.reviewed}</span></div>
          <div className="min-w-20 rounded-2xl border border-stone-200 bg-white px-3 py-3 shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:min-w-24"><strong className="block text-xl text-stone-700 dark:text-stone-200">{stats.total}</strong><span className="text-xs text-stone-500">{text.total}</span></div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">Could not load games: {error}</div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <GameList data={gamePage} filters={filters} text={text} />
          <aside className="space-y-5 lg:sticky lg:top-24">
            <AnalysisQueue candidates={candidates} totalWaiting={stats.waiting} />
            <LocalOperations text={text} />
          </aside>
        </div>
      )}
    </main>
  );
}
