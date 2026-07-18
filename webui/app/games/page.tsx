import GameList from "@/features/games/GameList";
import LocalOperations from "@/features/games/LocalOperations";
import type { GameArchiveStats, GameListFilters, GamePage } from "@/domain/games";
import { getGameArchiveStats, listGames } from "@/server/repositories/games";

export const dynamic = "force-dynamic";

type GamesSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function GamesPage({ searchParams }: { searchParams: GamesSearchParams }) {
  const query = await searchParams;
  const requestedTime = first(query.time);
  const requestedReview = first(query.review);
  const filters: GameListFilters = {
    query: first(query.q).trim().slice(0, 100),
    timeClass: ["rapid", "blitz", "bullet", "all"].includes(requestedTime)
      ? requestedTime as GameListFilters["timeClass"]
      : "rapid",
    review: ["all", "reviewed", "waiting"].includes(requestedReview)
      ? requestedReview as GameListFilters["review"]
      : "all",
  };
  const requestedPage = Math.max(1, Number.parseInt(first(query.page), 10) || 1);
  let gamePage: GamePage = { games: [], total: 0, page: 1, pageSize: 40, totalPages: 1 };
  let stats: GameArchiveStats = { total: 0, reviewed: 0 };
  let error: string | null = null;
  try {
    [gamePage, stats] = await Promise.all([
      listGames(filters, requestedPage),
      getGameArchiveStats(),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load games.";
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Your chess archive</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">Game Review</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
            Pick a game to see its turning points, evaluation graph, move labels, and practical coach notes.
          </p>
        </div>
        <div className="flex gap-3 text-center">
          <div className="min-w-24 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm dark:border-stone-700 dark:bg-stone-900"><strong className="block text-xl text-stone-900 dark:text-stone-50">{stats.total}</strong><span className="text-xs text-stone-500">Games</span></div>
          <div className="min-w-24 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm dark:border-stone-700 dark:bg-stone-900"><strong className="block text-xl text-emerald-700 dark:text-emerald-400">{stats.reviewed}</strong><span className="text-xs text-stone-500">Reviewed</span></div>
        </div>
      </section>

      <LocalOperations />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">Could not load games: {error}</div>
      ) : (
        <GameList data={gamePage} filters={filters} />
      )}
    </main>
  );
}
