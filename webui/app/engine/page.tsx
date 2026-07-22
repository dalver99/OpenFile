import AnalysisQueue from "@/features/games/AnalysisQueue";
import ImportGameCard from "@/features/games/ImportGameCard";
import EngineStatus from "@/features/engine/EngineStatus";
import { getGameArchiveStats, listAnalysisCandidates } from "@/server/data/games";
import { listCollections } from "@/server/data/collections";
import { runtimeSettings } from "@/server/data/settings";
import { isDemoMode } from "@/server/demo-mode";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  const config = await runtimeSettings();
  const demo = isDemoMode();
  const [stats, candidates, collections] = await Promise.all([
    getGameArchiveStats(),
    listAnalysisCandidates(200),
    listCollections(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6 lg:h-[calc(100dvh-4rem)] lg:flex-none lg:overflow-hidden lg:py-8">
      <header className="mb-6 shrink-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-400">Work running on this computer</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-stone-900 dark:text-white sm:text-4xl">Engine room</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">Import individual games, choose what Stockfish reviews, and see exactly what the local worker is doing.</p>
      </header>
      <div className="grid min-h-0 flex-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-h-0 lg:h-full lg:overflow-y-auto lg:pr-2">
          <AnalysisQueue candidates={candidates} totalWaiting={stats.waiting} demo={demo} />
        </div>
        <aside className="space-y-5 lg:h-full lg:overflow-y-auto lg:pr-1">
          <EngineStatus
            stockfishPath={config.stockfish_path?.trim() || null}
            threads={Math.max(1, config.stockfish_threads ?? 1)}
            hashMb={Math.max(16, config.stockfish_hash_mb ?? 128)}
            demo={demo}
          />
          <ImportGameCard collections={collections} demo={demo} />
        </aside>
      </div>
    </main>
  );
}
