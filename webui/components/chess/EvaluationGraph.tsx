"use client";

import type { ReviewMove } from "@/domain/games";
import { classificationMeta, graphEvaluation } from "@/lib/review";

function evaluationY(evaluation: number, height: number, verticalPad: number): number {
  // A linear +/-12 scale visually understates normal winning evaluations.
  // Tanh makes +4/-4 decisive while still fitting mates and extreme scores.
  const normalized = Math.tanh(evaluation / 500);
  const usableHalf = height / 2 - verticalPad;
  return Math.round((height / 2 - normalized * usableHalf) * 1_000) / 1_000;
}

export default function EvaluationGraph({
  moves,
  selectedPly,
  onSelect,
  compact = false,
  classifications = {},
}: {
  moves: ReviewMove[];
  selectedPly: number;
  onSelect: (ply: number) => void;
  compact?: boolean;
  classifications?: Record<number, string>;
}) {
  const width = 920;
  const height = compact ? 140 : 220;
  const verticalPad = compact ? 14 : 22;
  const points = [{ x: 0, y: height / 2 }].concat(
    moves.map((move, index) => {
      const evaluation = graphEvaluation(move);
      return {
        x: ((index + 1) / moves.length) * width,
        y: evaluationY(evaluation, height, verticalPad),
      };
    }),
  );
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const selected = points[Math.max(0, selectedPly)] ?? points[0];

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
      {!compact ? <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3 dark:border-stone-800">
        <div>
          <h3 className="font-semibold text-stone-900 dark:text-stone-50">Game evaluation</h3>
          <p className="text-xs text-stone-500">White advantage above the center line, Black below</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-brand-500" /> White</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-700" /> Black</span>
        </div>
      </div> : null}
      <div className={compact ? "relative py-2" : "relative py-3"}>
        <svg viewBox={`0 0 ${width} ${height}`} className={compact ? "h-24 w-full" : "h-48 w-full"} role="img" aria-label="Engine evaluation after every move">
          <defs>
            <clipPath id="eval-chart-clip">
              <rect x="0" y="0" width={width} height={height} rx="10" />
            </clipPath>
          </defs>
          <g clipPath="url(#eval-chart-clip)">
            <rect x="0" y="0" width={width} height={height} fill="#1c1917" />
            <path
              d={`${path} L${width},${height} L0,${height} Z`}
              fill="#fafaf9"
            />
            <line
              x1={0}
              x2={width}
              y1={height / 2}
              y2={height / 2}
              stroke="#78716c"
              strokeWidth="2"
            />
            <path
              d={path}
              fill="none"
              stroke="#a8a29e"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {moves.map((move, index) => {
              const point = points[index + 1];
              const classification = classifications[move.ply] ?? move.classification;
              const meta = classificationMeta[classification] ?? classificationMeta.unknown;
              const critical = ["brilliant", "great", "mistake", "blunder"].includes(classification);
              return (
                <circle
                  key={move.ply}
                  cx={point.x}
                  cy={point.y}
                  r={critical ? 5 : 2.5}
                  fill={meta.color}
                  className="cursor-pointer"
                  onClick={() => onSelect(move.ply)}
                >
                  <title>{`${move.move_number}${move.side === "black" ? "..." : "."} ${move.san} — ${classification}`}</title>
                </circle>
              );
            })}
            {selected ? (
              <>
                <line x1={selected.x} x2={selected.x} y1={0} y2={height} stroke="#65a30d" strokeWidth="3" />
                <circle cx={selected.x} cy={selected.y} r="7" fill="#65a30d" stroke="#fff" strokeWidth="3" />
              </>
            ) : null}
          </g>
        </svg>
      </div>
    </div>
  );
}
