import { Chess } from "chess.js";
import type { CandidateLine, ReviewMove } from "@/domain/games";

export const classificationMeta: Record<string, { label: string; color: string; symbol: string }> = {
  brilliant: { label: "Brilliant", color: "#22c55e", symbol: "!!" },
  great: { label: "Great", color: "#38bdf8", symbol: "!" },
  excellent: { label: "Excellent", color: "#84cc16", symbol: "👍" },
  best: { label: "Best", color: "#65a30d", symbol: "★" },
  book: { label: "Book", color: "#c08457", symbol: "📖" },
  good: { label: "Good", color: "#a3a3a3", symbol: "✓" },
  inaccuracy: { label: "Inaccuracy", color: "#facc15", symbol: "?!" },
  mistake: { label: "Mistake", color: "#fb923c", symbol: "?" },
  blunder: { label: "Blunder", color: "#ef4444", symbol: "??" },
  unknown: { label: "Book / neutral", color: "#a3a3a3", symbol: "" },
};

export function candidateMove(line: CandidateLine | undefined): string | null {
  return line?.move ?? line?.best_move ?? null;
}

export function moveToSan(fen: string, uci: string | null): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || "q",
    }).san;
  } catch {
    return null;
  }
}

export function whiteEvaluation(move: ReviewMove): number {
  const score = move.evaluation_after_cp ?? 0;
  return move.side === "white" ? score : -score;
}

export function graphEvaluation(move: ReviewMove): number {
  const score = whiteEvaluation(move);
  if (Math.abs(score) >= 90_000) return Math.sign(score || 1) * 1_200;
  return Math.max(-1_200, Math.min(1_200, score));
}

export function formatEvaluation(cp: number | null, side?: "white" | "black"): string {
  if (cp == null) return "—";
  const whiteCp = side === "black" ? -cp : cp;
  if (Math.abs(whiteCp) >= 90_000) return whiteCp > 0 ? "M" : "-M";
  const pawns = whiteCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export function accuracyFor(moves: ReviewMove[], side: "white" | "black"): number {
  const losses = moves
    .filter((move) => move.side === side && move.centipawn_loss != null)
    .map((move) => Math.min(move.centipawn_loss ?? 0, 1_000));
  if (!losses.length) return 100;
  const average = losses.reduce((sum, loss) => sum + loss, 0) / losses.length;
  return Math.max(1, Math.round(100 * Math.exp(-average / 250)));
}

export function moveComment(
  move: ReviewMove,
  options?: { isBook?: boolean; openingName?: string | null },
): string {
  if (options?.isBook) {
    return options.openingName
      ? `${move.san} is a book move in the ${options.openingName}.`
      : `${move.san} is a book move.`;
  }

  const loss = move.centipawn_loss ?? 0;
  const best = candidateMove(move.top_moves?.[0]);
  const bestSan = moveToSan(move.fen_before, best) ?? best;
  const swing = loss >= 100 ? `${(loss / 100).toFixed(1)} pawns` : `${loss} centipawns`;
  const alternative = best && best !== move.move_uci ? ` The engine preferred ${bestSan}.` : "";

  switch (move.classification) {
    case "brilliant":
      return `A difficult resource that changes the character of the position. The move finds the engine's tactical idea.`;
    case "great":
    case "excellent":
      return `A strong move that preserves the important features of the position.${alternative}`;
    case "best":
      return "The engine's first choice. This keeps the evaluation steady and asks the most of the opponent.";
    case "good":
      return `A sound move. There may be a slightly cleaner continuation, but the position remains under control.${alternative}`;
    case "inaccuracy":
      return `This concedes about ${swing}. The position is still playable, but a more precise move was available.${alternative}`;
    case "mistake":
      return `This is a meaningful turning point, giving away about ${swing}.${alternative} Review the candidate moves before committing.`;
    case "blunder":
      return `This move swings the evaluation by roughly ${swing}.${alternative} Look for forcing checks, captures, and threats first.`;
    default:
      return `The move was recorded, but the engine did not assign a confident label.${alternative}`;
  }
}

export function gameHeadline(moves: ReviewMove[], playerSide: "white" | "black"): string {
  const ownMoves = moves.filter((move) => move.side === playerSide);
  const severe = ownMoves.filter((move) => move.classification === "mistake" || move.classification === "blunder");
  const best = ownMoves.filter((move) => ["brilliant", "great", "excellent", "best"].includes(move.classification));
  if (!severe.length) return "A steady game with no major engine swings. The value is in the smaller precision gains.";
  if (severe.length === 1) return "One critical decision shaped the game. That position is the best place to focus your review.";
  if (best.length > severe.length) return "Several strong decisions were offset by a few sharp turning points. Review the swings first.";
  return "The evaluation changed direction more than once. Slow down around forcing moves and candidate selection.";
}
