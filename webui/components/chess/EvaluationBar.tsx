import { formatEvaluation } from "@/lib/review";

function whiteShare(cp: number): number {
  return Math.max(2, Math.min(98, 50 + Math.tanh(cp / 350) * 48));
}

export default function EvaluationBar({ cp }: { cp: number }) {
  const share = whiteShare(cp);

  return (
    <div
      aria-label={`Evaluation ${formatEvaluation(cp)}`}
      className="relative h-full min-h-0 overflow-hidden rounded-lg border border-stone-700 bg-stone-950 shadow-inner"
      title={`Evaluation ${formatEvaluation(cp)}`}
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-stone-50 transition-[height] duration-500 ease-out motion-reduce:transition-none"
        style={{ height: `${share}%` }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-stone-500/70" />
      <span
        className={`absolute inset-x-0 bottom-2 z-10 text-center text-[10px] font-black tabular-nums ${
          share > 14 ? "text-stone-950" : "text-stone-100"
        }`}
      >
        {formatEvaluation(cp)}
      </span>
    </div>
  );
}
