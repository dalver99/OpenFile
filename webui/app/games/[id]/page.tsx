import { notFound } from "next/navigation";
import AnalysisLauncher from "@/features/games/AnalysisLauncher";
import GameReview from "@/features/review/GameReview";
import { getGameReview } from "@/server/data/games";
import { listCollections } from "@/server/data/collections";
import { isDemoMode } from "@/server/demo-mode";

export const dynamic = "force-dynamic";

export default async function GameReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId) || gameId <= 0) notFound();

  const [review, collections] = await Promise.all([getGameReview(gameId), listCollections()]);
  if (!review) notFound();

  return (
    <main className="mx-auto w-full max-w-[1800px] px-3 py-3 sm:px-5">
      {review.game.analyzed && review.moves.length ? (
        <GameReview review={review} collections={collections} demo={isDemoMode()} />
      ) : review.game.analyzed ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          The analysis record exists, but it contains no moves. Re-run the game analysis from the command line to rebuild it.
        </div>
      ) : (
        <AnalysisLauncher gameId={gameId} initialStatus={review.game.status} demo={isDemoMode()} />
      )}
    </main>
  );
}
