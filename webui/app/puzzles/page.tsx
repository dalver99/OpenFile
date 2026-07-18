import PuzzleTrainer from "@/features/puzzles/PuzzleTrainer";
import { listPuzzles } from "@/server/repositories/puzzles";

export const dynamic = "force-dynamic";

export default async function PuzzlesPage() {
  let puzzles = [] as Awaited<ReturnType<typeof listPuzzles>>;
  let error: string | null = null;
  try {
    puzzles = await listPuzzles();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load puzzles.";
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-7 flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">Practice from your games</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">Puzzle training</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">Calculate without engine hints, then replay the best continuation in normal chess notation.</p>
      </header>
      {error ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">Could not load puzzles: {error}</div>
      ) : (
        <PuzzleTrainer puzzles={puzzles} />
      )}
    </main>
  );
}
