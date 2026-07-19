import { getGameReview } from "@/server/repositories/games";
import { lichessApiKey } from "@/server/database/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExplorerMove = {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  opening?: {
    eco: string;
    name: string;
  } | null;
};

type ExplorerResponse = {
  moves?: ExplorerMove[];
  opening?: {
    eco: string;
    name: string;
  } | null;
};

type BookMove = {
  ply: number;
  book: boolean;
  games: number;
  eco: string | null;
  openingName: string | null;
};

type BookResponse = {
  available: true;
  source: "lichess_masters";
  moves: BookMove[];
};

type CacheEntry = {
  expiresAt: number;
  value: BookResponse;
};

const globalCache = globalThis as typeof globalThis & {
  openingBookCache?: Map<number, CacheEntry>;
  openingPositionCache?: Map<
    string,
    { expiresAt: number; value: ExplorerResponse }
  >;
};
const cache = globalCache.openingBookCache ?? new Map<number, CacheEntry>();
const positionCache =
  globalCache.openingPositionCache ??
  new Map<string, { expiresAt: number; value: ExplorerResponse }>();
globalCache.openingBookCache = cache;
globalCache.openingPositionCache = positionCache;

const MAX_BOOK_PLIES = 40;
const MAX_CONSECUTIVE_MISSES = 4;
const BOOK_POSITION_TTL_MS = 24 * 60 * 60 * 1_000;

function parseGameId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function explore(
  initialFen: string,
  play: string[],
  token: string,
): Promise<ExplorerResponse> {
  const cacheKey = `${initialFen}|${play.join(",")}`;
  const cached = positionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = new URL("https://explorer.lichess.org/masters");
  url.searchParams.set("fen", initialFen);
  if (play.length) url.searchParams.set("play", play.join(","));
  url.searchParams.set("moves", "50");
  url.searchParams.set("topGames", "0");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`lichess_${response.status}`);
  }
  const value = await response.json() as ExplorerResponse;
  positionCache.set(cacheKey, {
    expiresAt: Date.now() + BOOK_POSITION_TTL_MS,
    value,
  });
  return value;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const playerGameId = parseGameId((await params).id);
  if (playerGameId == null) {
    return Response.json({ error: "invalid_game_id" }, { status: 400 });
  }

  const token = lichessApiKey();
  if (!token) {
    return Response.json(
      { available: false, error: "lichess_api_key_missing" },
      { status: 200 },
    );
  }

  const cached = cache.get(playerGameId);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.value);
  }

  const review = await getGameReview(playerGameId);
  if (!review?.moves.length) {
    return Response.json({ error: "game_not_analyzed" }, { status: 404 });
  }

  try {
    const initialFen = review.moves[0].fen_before;
    const play: string[] = [];
    const moves: BookMove[] = [];
    let currentOpening: ExplorerResponse["opening"] = null;
    let consecutiveMisses = 0;

    for (const move of review.moves.slice(0, MAX_BOOK_PLIES)) {
      const position = await explore(initialFen, play, token);
      if (position.opening) {
        currentOpening = position.opening;
        const previous = moves.at(-1);
        if (previous?.book) {
          previous.eco = position.opening.eco;
          previous.openingName = position.opening.name;
        }
      }

      const match = position.moves?.find((candidate) => candidate.uci === move.move_uci);
      const games = match ? match.white + match.draws + match.black : 0;
      const isBook = games >= 2;
      const resultingOpening = match?.opening ?? currentOpening;
      moves.push({
        ply: move.ply,
        book: isBook,
        games,
        eco: resultingOpening?.eco ?? null,
        openingName: resultingOpening?.name ?? null,
      });

      play.push(move.move_uci);
      if (match?.opening) currentOpening = match.opening;
      consecutiveMisses = isBook ? 0 : consecutiveMisses + 1;
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) break;
    }

    const value: BookResponse = {
      available: true,
      source: "lichess_masters",
      moves,
    };
    cache.set(playerGameId, {
      expiresAt: Date.now() + 15 * 60 * 1_000,
      value,
    });
    return Response.json(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "lichess_unavailable";
    const status = message === "lichess_401" || message === "lichess_403"
      ? 502
      : message === "lichess_429"
        ? 429
        : 502;
    return Response.json({ available: false, error: message }, { status });
  }
}
