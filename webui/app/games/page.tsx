import GameList from "@/features/games/GameList";
import LocalOperations from "@/features/games/LocalOperations";
import type {
  GameArchiveStats,
  GameCollection,
  GameListFilters,
  GamePage,
  OpeningFamily,
} from "@/domain/games";
import {
  getGameArchiveStats,
  listGames,
  listOpeningFamilies,
} from "@/server/repositories/games";
import { listCollections } from "@/server/repositories/collections";
import { localConfig } from "@/server/database/config";
import { language, messages } from "@/i18n/messages";

export const dynamic = "force-dynamic";

type GamesSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: GamesSearchParams;
}) {
  const query = await searchParams;
  const text = messages[language(localConfig().language)].games;
  const requestedTime = first(query.time);
  const requestedReview = first(query.review);
  const requestedFavorite = first(query.favorite);
  const requestedSyncRun = Number.parseInt(first(query.sync), 10);
  const requestedCollection = Number.parseInt(first(query.collection), 10);
  const requestedOpening = first(query.opening).toLowerCase();
  const filters: GameListFilters = {
    query: first(query.q).trim().slice(0, 100),
    timeClass: ["rapid", "blitz", "bullet", "all"].includes(requestedTime)
      ? (requestedTime as GameListFilters["timeClass"])
      : "rapid",
    review: ["all", "reviewed", "waiting"].includes(requestedReview)
      ? (requestedReview as GameListFilters["review"])
      : "reviewed",
    favorite: requestedFavorite === "favorites" ? "favorites" : "all",
    syncRunId:
      Number.isSafeInteger(requestedSyncRun) && requestedSyncRun > 0
        ? requestedSyncRun
        : null,
    collectionId:
      Number.isSafeInteger(requestedCollection) && requestedCollection > 0
        ? requestedCollection
        : null,
    openingFamily: /^[a-z0-9-]{1,100}$/.test(requestedOpening)
      ? requestedOpening
      : null,
  };
  const requestedPage = Math.max(
    1,
    Number.parseInt(first(query.page), 10) || 1,
  );
  let gamePage: GamePage = {
    games: [],
    total: 0,
    page: 1,
    pageSize: 40,
    totalPages: 1,
  };
  let stats: GameArchiveStats = {
    total: 0,
    reviewed: 0,
    waiting: 0,
    analyzing: 0,
  };
  let collections: GameCollection[] = [];
  let openingFamilies: OpeningFamily[] = [];
  let error: string | null = null;
  try {
    [gamePage, stats, collections, openingFamilies] = await Promise.all([
      listGames(filters, requestedPage),
      getGameArchiveStats(),
      listCollections(),
      listOpeningFamilies(),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load games.";
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
            {text.eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">
            {text.title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
            {text.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
          <span>
            <strong className="mr-1 text-sm text-brand-700 dark:text-brand-400">
              {stats.waiting}
            </strong>{" "}
            need review
          </span>
          <span>
            <strong className="mr-1 text-sm text-stone-800 dark:text-stone-200">
              {stats.reviewed}
            </strong>{" "}
            {text.reviewed.toLowerCase()}
          </span>
          <span>
            <strong className="mr-1 text-sm text-stone-800 dark:text-stone-200">
              {stats.total}
            </strong>{" "}
            {text.total.toLowerCase()}
          </span>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          Could not load games: {error}
        </div>
      ) : (
        <div className="space-y-6">
          <LocalOperations text={text} />
          <GameList
            data={gamePage}
            filters={filters}
            text={text}
            collections={collections}
            openingFamilies={openingFamilies}
          />
        </div>
      )}
    </main>
  );
}
