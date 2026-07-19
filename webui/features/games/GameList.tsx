import Link from "next/link";
import type { GameCard, GameCollection, GameListFilters, GamePage, OpeningFamily } from "@/domain/games";
import type { messages } from "@/i18n/messages";
import FavoriteButton from "@/features/games/FavoriteButton";
import CollectionMenu from "@/features/games/CollectionMenu";

type GameText = typeof messages.en.games | typeof messages.ko.games;

function outcome(game: GameCard): { label: string; icon: string; badge: string; row: string } {
  if (game.result === "win") return {
    label: "Win",
    icon: "↑",
    badge: "border border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-400",
    row: "border-l-2 border-l-emerald-300 hover:bg-stone-50 dark:border-l-emerald-900 dark:hover:bg-stone-800/45",
  };
  if (["agreed", "stalemate", "repetition", "insufficient", "50move", "timevsinsufficient"].includes(game.result)) {
    return {
      label: "Draw",
      icon: "=",
      badge: "border border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300",
      row: "border-l-2 border-l-stone-300 hover:bg-stone-50 dark:border-l-stone-700 dark:hover:bg-stone-800/45",
    };
  }
  return {
    label: "Loss",
    icon: "↓",
    badge: "border border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900 dark:bg-rose-950/25 dark:text-rose-400",
    row: "border-l-2 border-l-rose-300 hover:bg-stone-50 dark:border-l-rose-900 dark:hover:bg-stone-800/45",
  };
}

function titleCase(value: string | null): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Game";
}

function gamesHref(
  filters: GameListFilters,
  changes: Partial<GameListFilters> & { page?: number },
): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  params.set("time", next.timeClass);
  params.set("review", next.review);
  if (next.favorite === "favorites") params.set("favorite", "favorites");
  if (next.syncRunId !== null) params.set("sync", String(next.syncRunId));
  if (next.collectionId !== null) params.set("collection", String(next.collectionId));
  if (next.openingFamily) params.set("opening", next.openingFamily);
  if (changes.page && changes.page > 1) params.set("page", String(changes.page));
  return `/games?${params.toString()}`;
}

export default function GameList({
  data,
  filters,
  text,
  collections,
  openingFamilies,
}: {
  data: GamePage;
  filters: GameListFilters;
  text: GameText;
  collections: GameCollection[];
  openingFamilies: OpeningFamily[];
}) {
  const games = data.games;
  const activeCollection = collections.find((collection) => collection.id === filters.collectionId) ?? null;
  const activeOpening = openingFamilies.find((opening) => opening.slug === filters.openingFamily) ?? null;

  return (
    <div className="space-y-5">
      {filters.syncRunId !== null ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100 sm:flex-row sm:items-center sm:justify-between">
          <span><strong>{data.total}</strong> {data.total === 1 ? "game" : "games"} added by sync #{filters.syncRunId}</span>
          <Link
            href={gamesHref(filters, { syncRunId: null })}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Show the full archive
          </Link>
        </div>
      ) : null}
      {activeCollection || activeOpening ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100">
          <span>Showing {activeCollection ? `collection “${activeCollection.name}”` : `opening family “${activeOpening?.name}”`}</span>
          <Link href={gamesHref(filters, activeCollection ? { collectionId: null } : { openingFamily: null })} className="font-bold hover:underline">Clear filter</Link>
        </div>
      ) : null}
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form action="/games" method="get" className="flex flex-1 items-center gap-2 rounded-xl bg-stone-100 px-3 py-2.5 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <span aria-hidden>⌕</span>
            <label htmlFor="game-search" className="sr-only">Search games</label>
            <input
              id="game-search"
              name="q"
              defaultValue={filters.query}
              placeholder={text.search}
              className="w-full bg-transparent outline-none placeholder:text-stone-400"
            />
            <input type="hidden" name="time" value={filters.timeClass} />
            <input type="hidden" name="review" value={filters.review} />
            <input type="hidden" name="favorite" value={filters.favorite} />
            {filters.syncRunId !== null ? <input type="hidden" name="sync" value={filters.syncRunId} /> : null}
            {filters.collectionId !== null ? <input type="hidden" name="collection" value={filters.collectionId} /> : null}
            {filters.openingFamily ? <input type="hidden" name="opening" value={filters.openingFamily} /> : null}
            {filters.query ? (
              <Link
                href={gamesHref(filters, { query: "" })}
                className="rounded-md px-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                aria-label="Clear search"
              >
                ×
              </Link>
            ) : null}
          </form>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={gamesHref(filters, {
                favorite: filters.favorite === "favorites" ? "all" : "favorites",
              })}
              aria-pressed={filters.favorite === "favorites"}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                filters.favorite === "favorites"
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                  : "border-stone-200 text-stone-500 hover:border-amber-300 hover:text-amber-700 dark:border-stone-700 dark:text-stone-300"
              }`}
            >
              ★ {text.favorites}
            </Link>
            <span className="px-1 text-xs font-medium text-stone-400">
              {data.total} {data.total === 1 ? "game" : "games"}
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-2 sm:flex-row">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
            {(["rapid", "blitz", "bullet", "all"] as const).map((item) => (
              <Link
                key={item}
                href={gamesHref(filters, { timeClass: item })}
                className={`shrink-0 rounded-lg px-3 py-1.5 capitalize transition ${
                  filters.timeClass === item
                    ? "bg-white font-semibold text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white"
                    : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                }`}
              >
                {item}
              </Link>
            ))}
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
            {(["all", "reviewed", "waiting"] as const).map((item) => (
              <Link
                key={item}
                href={gamesHref(filters, { review: item })}
                className={`shrink-0 rounded-lg px-3 py-1.5 capitalize transition ${
                  filters.review === item
                    ? "bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white"
                    : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                }`}
              >
                {item === "waiting" ? "Needs review" : item}
              </Link>
            ))}
          </div>
        </div>
        <div className="border-t border-stone-100 pt-3 dark:border-stone-800">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400">Browse by opening family</p><p className="mt-0.5 text-[11px] text-stone-500">Variations are grouped under their parent opening.</p></div>
            {filters.openingFamily ? <Link href={gamesHref(filters, { openingFamily: null })} className="text-xs font-bold text-brand-700 hover:underline dark:text-brand-400">All openings</Link> : null}
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {openingFamilies.slice(0, 10).map((opening) => (
              <Link key={opening.slug} href={gamesHref(filters, { openingFamily: opening.slug })} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${filters.openingFamily === opening.slug ? "border-brand-700 bg-brand-700 text-white" : "border-stone-200 bg-white text-stone-600 hover:border-brand-400 hover:text-brand-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"}`}>
                {opening.name} <span className="opacity-60">{opening.count}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto border-t border-stone-100 pt-3 dark:border-stone-800">
          <Link href="/collections" className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400 hover:text-brand-700">Collections →</Link>
          {collections.slice(0, 6).map((collection) => (
            <Link key={collection.id} href={gamesHref(filters, { collectionId: collection.id })} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${filters.collectionId === collection.id ? "border-stone-900 bg-stone-900 text-white dark:border-white dark:bg-white dark:text-stone-900" : "border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300"}`}><i className="h-2 w-2 rounded-full" style={{ backgroundColor: collection.color }} />{collection.name}</Link>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
        {games.length ? games.map((game) => {
          const result = outcome(game);
          const opponent = game.side === "white" ? game.black_username : game.white_username;
          const opponentRating = game.side === "white" ? game.black_rating : game.white_rating;
          return (
            <article
              key={game.id}
              className={`group relative border-b border-stone-100 transition last:border-b-0 dark:border-stone-800 ${result.row}`}
            >
              <Link
                href={`/games/${game.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="grid gap-4 px-4 py-4 pr-28 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6 sm:pr-32"
              >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex min-w-16 items-center justify-center gap-1 rounded-md px-2 py-0.5 text-xs font-black ${result.badge}`}><span aria-hidden>{result.icon}</span>{result.label}</span>
                  <h2 className="truncate font-semibold text-stone-900 dark:text-stone-50">vs {opponent}</h2>
                  {opponentRating ? <span className="text-sm text-stone-400">{opponentRating}</span> : null}
                </div>
                <p className="mt-1 truncate text-sm text-stone-500">
                  {game.opening ? titleCase(game.opening) : "Opening unavailable"}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-stone-500 sm:justify-end">
                <span className="rounded-md bg-stone-100 px-2 py-1 dark:bg-stone-800">{titleCase(game.time_class)}</span>
                <span>{game.played_at ?? "Unknown date"}</span>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${game.analyzed ? "bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300" : game.status === "analyzing" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`} title={game.analyzed ? "Your OpenFile accuracy for this game" : undefined}>
                  <i className="h-1.5 w-1.5 rounded-full bg-current" />
                  {game.analyzed ? <><strong className="font-black">{game.accuracy ?? 100}</strong> accuracy</> : game.status === "analyzing" ? "Analyzing" : "Analyze →"}
                </span>
                {game.analyzed || game.status === "analyzing" ? <span className="text-lg text-stone-300 transition group-hover:translate-x-1 group-hover:text-brand-600">→</span> : null}
              </div>
              </Link>
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 sm:right-5">
                <CollectionMenu gameId={game.id} collections={collections} initialCollectionIds={game.collection_ids} />
                <FavoriteButton gameId={game.id} initialFavorite={game.is_favorite} />
              </div>
            </article>
          );
        }) : (
          <div className="px-6 py-16 text-center text-sm text-stone-500">
            {filters.syncRunId !== null
              ? "No games from this sync match the selected filters."
              : filters.favorite === "favorites"
              ? "No favorite games match this view."
              : `No ${filters.timeClass === "all" ? "" : `${filters.timeClass} `}games match this view.`}
            {filters.timeClass !== "all" ? (
              <Link
                href={gamesHref(filters, { timeClass: "all" })}
                className="ml-1 font-semibold text-brand-700 hover:underline"
              >
                Show all games
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {data.totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-4 text-sm" aria-label="Game archive pages">
          {data.page > 1 ? (
            <Link href={gamesHref(filters, { page: data.page - 1 })} className="rounded-xl border border-stone-200 bg-white px-4 py-2 font-semibold text-stone-700 hover:border-brand-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">← {text.previous}</Link>
          ) : <span />}
          <span className="text-xs font-medium text-stone-500">{text.page} {data.page} {text.of} {data.totalPages}</span>
          {data.page < data.totalPages ? (
            <Link href={gamesHref(filters, { page: data.page + 1 })} className="rounded-xl border border-stone-200 bg-white px-4 py-2 font-semibold text-stone-700 hover:border-brand-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">{text.next} →</Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}
