import Link from "next/link";
import { Chess } from "chess.js";
import AnalysisWorkbench, {
  type AnalysisPositionFrame,
} from "@/features/analysis/AnalysisWorkbench";
import type { GameReview } from "@/domain/games";
import { getGameReview } from "@/server/data/games";
import FavoriteButton from "@/features/games/FavoriteButton";
import { isDemoMode } from "@/server/demo-mode";

type AnalysisSearchParams = Promise<{
  game?: string | string[];
  ply?: string | string[];
  line?: string | string[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function framePrefix(chess: Chess): string {
  const fields = chess.fen().split(" ");
  const moveNumber = Number.parseInt(fields[5] ?? "1", 10) || 1;
  return chess.turn() === "b"
    ? `${moveNumber}... `
    : `${moveNumber}. `;
}

function reviewAnalysisState(
  review: GameReview,
  requestedPly: number,
  requestedLine: string | undefined,
): {
  frames: AnalysisPositionFrame[];
  cursor: number;
  positionLabel: string;
} | null {
  if (!review.moves.length) return null;

  const mainlineFrames: AnalysisPositionFrame[] = [
    {
      fen: review.moves[0].fen_before,
      uci: null,
      san: null,
      label: "Start",
    },
    ...review.moves.map((move) => ({
      fen: move.fen_after,
      uci: move.move_uci,
      san: move.san,
      label: `${move.move_number}${move.side === "black" ? "..." : "."} ${move.san}`,
    })),
  ];
  const anchorPly = Math.max(0, Math.min(review.moves.length, requestedPly));
  const lineMoves = (requestedLine ?? "")
    .split(",")
    .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
    .slice(0, 200);

  if (!lineMoves.length) {
    return {
      frames: mainlineFrames,
      cursor: anchorPly,
      positionLabel: mainlineFrames[anchorPly].label,
    };
  }

  const frames = mainlineFrames.slice(0, anchorPly + 1);
  const chess = new Chess(frames[frames.length - 1].fen);
  for (const uci of lineMoves) {
    try {
      const moveNumberLabel = framePrefix(chess);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
      frames.push({
        fen: chess.fen(),
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        san: move.san,
        label: `${moveNumberLabel}${move.san}`,
      });
    } catch {
      break;
    }
  }
  return {
    frames,
    cursor: frames.length - 1,
    positionLabel: frames.at(-1)?.label ?? "Sideline",
  };
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: AnalysisSearchParams;
}) {
  const query = await searchParams;
  const demo = isDemoMode();
  const gameId = integer(first(query.game), 0);
  const review = gameId > 0 ? await getGameReview(gameId) : null;
  const imported = review
    ? reviewAnalysisState(
        review,
        integer(first(query.ply), 0),
        first(query.line),
      )
    : null;
  const sourceTitle = review
    ? `${review.game.white_username} vs ${review.game.black_username}`
    : null;

  return (
    <main className="mx-auto w-full max-w-[1800px] px-3 py-4 sm:px-5 sm:py-6 2xl:px-6">
      <section className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end xl:mb-2 xl:items-center">
        <div className="xl:hidden">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-400">Local engine room</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50">Analysis board</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            {imported && sourceTitle
              ? `Continuing ${sourceTitle} at ${imported.positionLabel}. The complete line is ready to explore.`
              : "Explore any legal line with the Stockfish binary on this computer. Nothing here is saved to your game database."}
          </p>
        </div>
        {review ? (
          <div className="flex items-center gap-2">
            <FavoriteButton gameId={review.game.id} initialFavorite={review.game.is_favorite} showLabel />
            <Link href={`/games/${review.game.id}`} className="text-sm font-bold text-brand-700 hover:underline dark:text-brand-400">
              ← Back to review
            </Link>
          </div>
        ) : null}
      </section>
      <AnalysisWorkbench
        initialFrames={imported?.frames}
        initialCursor={imported?.cursor}
        demo={demo}
      />
    </main>
  );
}
