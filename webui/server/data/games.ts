import "server-only";

import type { GameListFilters, ReviewSideline } from "@/domain/games";
import { demoAnalysisCandidates, demoArchiveStats, demoGameReview, demoListGames, demoOpeningFamilies } from "@/server/demo/data";

export async function listGames(filters: GameListFilters, page = 1, pageSize = 40) {
  return demoListGames(filters, page, pageSize);
}

export async function getGameArchiveStats() {
  return demoArchiveStats();
}

export async function listAnalysisCandidates(limit = 80) {
  return demoAnalysisCandidates(limit);
}

export async function listOpeningFamilies() {
  return demoOpeningFamilies();
}

export async function getGameReview(id: number) {
  return demoGameReview(id);
}

export async function setGameFavorite(id: number, favorite: boolean) {
  void favorite;
  return demoGameReview(id) ? "saved" as const : "missing" as const;
}

export async function getSidelineAnchorFen(gameId: number, anchorPly: number) {
  const review = demoGameReview(gameId);
  if (!review?.moves.length) return null;
  return anchorPly === 0 ? review.moves[0].fen_before : review.moves.find((move) => move.ply === anchorPly)?.fen_after ?? null;
}

export async function saveReviewSideline(input: {
  id: number | null;
  playerGameId: number;
  anchorPly: number;
  startFen: string;
  movesUci: string[];
  movesSan: string[];
  title: string;
}): Promise<ReviewSideline | null> {
  if (!demoGameReview(input.playerGameId)) return null;
  const timestamp = new Date().toISOString();
  return {
    id: input.id ?? Date.now(), anchor_ply: input.anchorPly, start_fen: input.startFen,
    moves_uci: input.movesUci, moves_san: input.movesSan, title: input.title,
    created_at: timestamp, updated_at: timestamp,
  };
}

export async function deleteReviewSideline(id: number, gameId: number) {
  return Boolean(id && demoGameReview(gameId));
}

export async function getGameAnalysisStatus(id: number) {
  const review = demoGameReview(id);
  return review
    ? { found: true, analyzed: review.game.analyzed, status: review.game.status, detail: "demo_analysis_unavailable" }
    : { found: false, analyzed: false, status: null, detail: null };
}

export async function queueGameAnalysis(id: number, force = false) {
  return demoGameReview(id)?.game.analyzed && !force ? "ready" as const : "running" as const;
}

export async function queueGameAnalyses(ids: number[]) {
  return ids.filter((id) => Boolean(demoGameReview(id)));
}

export async function hasActiveGameAnalysis() {
  return false;
}

export async function markGameAnalysisFailed(id: number, detail: string) {
  void id;
  void detail;
}
