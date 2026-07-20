type EngineStatusProps = {
  stockfishPath: string | null;
  threads: number;
  hashMb: number;
};

export default function EngineStatus({ stockfishPath, threads, hashMb }: EngineStatusProps) {
  const executable = stockfishPath?.split(/[\\/]/).pop() || "Not configured";
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Local engine</p>
          <h2 className="mt-1 text-base font-black text-stone-900 dark:text-white">Stockfish on this computer</h2>
        </div>
        <span className={`h-2.5 w-2.5 rounded-full ${stockfishPath ? "bg-emerald-500" : "bg-amber-500"}`} title={stockfishPath ? "Configured" : "Setup needed"} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="col-span-2 rounded-xl bg-stone-50 px-3 py-2.5 dark:bg-stone-800/70"><dt className="text-stone-400">Executable</dt><dd className="mt-0.5 truncate font-mono font-semibold text-stone-700 dark:text-stone-200" title={stockfishPath ?? undefined}>{executable}</dd></div>
        <div className="rounded-xl bg-stone-50 px-3 py-2.5 dark:bg-stone-800/70"><dt className="text-stone-400">Threads</dt><dd className="mt-0.5 font-black text-stone-800 dark:text-stone-100">{threads}</dd></div>
        <div className="rounded-xl bg-stone-50 px-3 py-2.5 dark:bg-stone-800/70"><dt className="text-stone-400">Hash</dt><dd className="mt-0.5 font-black text-stone-800 dark:text-stone-100">{hashMb} MB</dd></div>
      </dl>
      <p className="mt-3 text-[11px] leading-5 text-stone-500">Queue jobs run one game at a time. Threads and hash come from your OpenFile configuration.</p>
    </section>
  );
}
