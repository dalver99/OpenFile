import Link from "next/link";
import type { GameCard, GameListFilters, GamePage } from "@/domain/games";

function outcome(game: GameCard): { label: string; cls: string } {
  if (game.result === "win") return { label: "Win", cls: "bg-emerald-100 text-emerald-700" };
  if (["agreed", "stalemate", "repetition", "insufficient", "50move", "timevsinsufficient"].includes(game.result)) {
    return { label: "Draw", cls: "bg-stone-200 text-stone-700" };
  }
  return { label: "Loss", cls: "bg-rose-100 text-rose-700" };
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
  if (changes.page && changes.page > 1) params.set("page", String(changes.page));
  return `/games?${params.toString()}`;
}

export default function GameList({ data, filters }: { data: GamePage; filters: GameListFilters }) {
  const games = data.games;

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form action="/games" method="get" className="flex flex-1 items-center gap-2 rounded-xl bg-stone-100 px-3 py-2.5 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <span aria-hidden>⌕</span>
            <label htmlFor="game-search" className="sr-only">Search games</label>
            <input
              id="game-search"
              name="q"
              defaultValue={filters.query}
              placeholder="Search opponent or opening"
              className="w-full bg-transparent outline-none placeholder:text-stone-400"
            />
            <input type="hidden" name="time" value={filters.timeClass} />
            <input type="hidden" name="review" value={filters.review} />
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
          <span className="shrink-0 px-1 text-xs font-medium text-stone-400">
            {data.total} {data.total === 1 ? "game" : "games"}
          </span>
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
                {item}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
        {games.length ? games.map((game) => {
          const result = outcome(game);
          const opponent = game.side === "white" ? game.black_username : game.white_username;
          const opponentRating = game.side === "white" ? game.black_rating : game.white_rating;
          return (
            <Link
              key={game.id}
              href={`/games/${game.id}`}
              className="group grid gap-4 border-b border-stone-100 px-4 py-4 transition last:border-b-0 hover:bg-emerald-50/50 dark:border-stone-800 dark:hover:bg-emerald-950/20 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${result.cls}`}>{result.label}</span>
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
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${game.analyzed ? "bg-emerald-100 text-emerald-700" : game.status === "analyzing" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                  <i className="h-1.5 w-1.5 rounded-full bg-current" />
                  {game.analyzed ? "Review ready" : game.status === "analyzing" ? "Analyzing" : "Needs review"}
                </span>
                <span className="text-lg text-stone-300 transition group-hover:translate-x-1 group-hover:text-emerald-600">→</span>
              </div>
            </Link>
          );
        }) : (
          <div className="px-6 py-16 text-center text-sm text-stone-500">
            No {filters.timeClass === "all" ? "" : `${filters.timeClass} `}games match this view.
            {filters.timeClass !== "all" ? (
              <Link
                href={gamesHref(filters, { timeClass: "all" })}
                className="ml-1 font-semibold text-emerald-700 hover:underline"
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
            <Link href={gamesHref(filters, { page: data.page - 1 })} className="rounded-xl border border-stone-200 bg-white px-4 py-2 font-semibold text-stone-700 hover:border-emerald-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">← Previous</Link>
          ) : <span />}
          <span className="text-xs font-medium text-stone-500">Page {data.page} of {data.totalPages}</span>
          {data.page < data.totalPages ? (
            <Link href={gamesHref(filters, { page: data.page + 1 })} className="rounded-xl border border-stone-200 bg-white px-4 py-2 font-semibold text-stone-700 hover:border-emerald-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">Next →</Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}
