import "server-only";

import fixture from "./fixtures.generated.json";
import type {
  GameArchiveStats,
  GameCard,
  GameCollection,
  GameListFilters,
  GamePage,
  GameReview,
  OpeningFamily,
} from "@/domain/games";
import type { PlayerInsights } from "@/domain/insights";
import type { PuzzleCard } from "@/domain/puzzles";
import { openingFamilyFromEcoUrl } from "@/lib/openings";

export type PuzzleSolution = {
  solution_uci: string;
  solution_san: string | null;
  solution_line_uci: string[];
};

const games = fixture.games as GameCard[];
const reviews = fixture.reviews as unknown as Record<string, GameReview>;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function opponent(game: GameCard): string {
  return game.side === "white" ? game.black_username : game.white_username;
}

export const demoProfile = copy(fixture.profile);
export const demoGeneratedAt = fixture.generatedAt;

export function demoListGames(
  filters: GameListFilters,
  requestedPage = 1,
  requestedPageSize = 40,
): GamePage {
  const query = filters.query.toLowerCase();
  const filtered = games.filter((game) => {
    if (filters.timeClass !== "all" && game.time_class !== filters.timeClass) return false;
    if (filters.review === "reviewed" && !game.analyzed) return false;
    if (filters.review === "waiting" && game.analyzed) return false;
    if (filters.favorite === "favorites" && !game.is_favorite) return false;
    if (filters.collectionId !== null && !game.collection_ids.includes(filters.collectionId)) return false;
    if (filters.openingFamily) {
      const family = openingFamilyFromEcoUrl(game.opening);
      if (family?.slug !== filters.openingFamily) return false;
    }
    if (query && !`${opponent(game)} ${game.opening ?? ""}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const pageSize = Math.max(10, Math.min(100, requestedPageSize));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(1, Math.min(totalPages, requestedPage));
  return {
    games: copy(filtered.slice((page - 1) * pageSize, page * pageSize)),
    total: filtered.length,
    page,
    pageSize,
    totalPages,
  };
}

export function demoArchiveStats(): GameArchiveStats {
  return {
    total: games.length,
    reviewed: games.filter((game) => game.analyzed).length,
    waiting: games.filter((game) => !game.analyzed).length,
    analyzing: 0,
  };
}

export function demoAnalysisCandidates(limit = 80): GameCard[] {
  return copy(games.filter((game) => !game.analyzed).slice(0, limit));
}

export function demoOpeningFamilies(): OpeningFamily[] {
  return copy(fixture.openingFamilies as OpeningFamily[]);
}

export function demoGameReview(id: number): GameReview | null {
  return reviews[String(id)] ? copy(reviews[String(id)]) : null;
}

export function demoCollections(): GameCollection[] {
  return copy(fixture.collections as GameCollection[]);
}

export function demoInsights(): PlayerInsights {
  return copy(fixture.insights as PlayerInsights);
}

export function demoPuzzles(limit = 100): PuzzleCard[] {
  return copy((fixture.puzzles as PuzzleCard[]).slice(0, limit));
}

export function demoPuzzleSolution(id: number): PuzzleSolution | null {
  const solutions = fixture.puzzleSolutions as Record<string, PuzzleSolution>;
  return solutions[String(id)] ? copy(solutions[String(id)]) : null;
}
