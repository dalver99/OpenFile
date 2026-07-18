import Link from "next/link";
import { notFound } from "next/navigation";
import AnalysisLauncher from "@/features/games/AnalysisLauncher";
import GameReview from "@/features/review/GameReview";
import { getGameReview } from "@/server/repositories/games";

export const dynamic = "force-dynamic";

export default async function GameReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId) || gameId <= 0) notFound();

  const review = await getGameReview(gameId);
  if (!review) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/games" className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-50">← All games</Link>
        <a href={review.game.chesscom_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-stone-400 hover:text-emerald-700">Open original game ↗</a>
      </div>
      {review.game.analyzed && review.moves.length ? (
        <GameReview review={review} />
      ) : review.game.analyzed ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          The analysis record exists, but it contains no moves. Re-run the game analysis from the command line to rebuild it.
        </div>
      ) : (
        <AnalysisLauncher gameId={gameId} initialStatus={review.game.status} />
      )}
    </main>
  );
}
