"use client";

import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEvaluation } from "@/lib/review";
import EvaluationBar from "@/components/chess/EvaluationBar";

const Board = dynamic(() => import("@/components/chess/Board"), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse rounded-xl bg-stone-200 dark:bg-stone-800" />,
});

const START_FEN = new Chess().fen();

export type AnalysisPositionFrame = {
  fen: string;
  uci: string | null;
  san: string | null;
  label: string;
};

type EngineLine = {
  rank: number;
  scoreCp: number;
  whiteCp: number;
  mate: number | null;
  whiteMate: number | null;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  pvUci: string[];
  pvSan: string[];
};

type AnalysisResult = {
  engine: string;
  depth: number;
  timeSec: number;
  multipv: number;
  sideToMove: "white" | "black";
  fen: string;
  lines: EngineLine[];
};

function moveLabel(chess: Chess, san: string): string {
  const fullMove = Number(chess.fen().split(" ")[5] ?? "1");
  return chess.turn() === "b" ? `${fullMove}... ${san}` : `${fullMove}. ${san}`;
}

function lineEvaluation(line: EngineLine): string {
  if (line.whiteMate != null) {
    return line.whiteMate > 0 ? `M${Math.abs(line.whiteMate)}` : `-M${Math.abs(line.whiteMate)}`;
  }
  return formatEvaluation(line.whiteCp);
}

function positionFramesFromPgn(pgn: string): AnalysisPositionFrame[] {
  const parsed = new Chess();
  parsed.loadPgn(pgn);
  const headers = parsed.getHeaders();
  const startFen = headers.FEN || START_FEN;
  const replay = new Chess(startFen);
  const frames: AnalysisPositionFrame[] = [{ fen: replay.fen(), uci: null, san: null, label: "Start" }];
  for (const historyMove of parsed.history({ verbose: true })) {
    const labelPrefix = moveLabel(replay, historyMove.san);
    const move = replay.move({
      from: historyMove.from,
      to: historyMove.to,
      promotion: historyMove.promotion || "q",
    });
    frames.push({
      fen: replay.fen(),
      uci: `${move.from}${move.to}${move.promotion ?? ""}`,
      san: move.san,
      label: labelPrefix,
    });
  }
  return frames;
}

export default function AnalysisWorkbench({
  initialFrames,
  initialCursor = 0,
}: {
  initialFrames?: AnalysisPositionFrame[];
  initialCursor?: number;
}) {
  const startingFrames = initialFrames?.length
    ? initialFrames
    : [{ fen: START_FEN, uci: null, san: null, label: "Start" }];
  const startingCursor = Math.max(
    0,
    Math.min(startingFrames.length - 1, initialCursor),
  );
  const [frames, setFrames] = useState<AnalysisPositionFrame[]>(startingFrames);
  const [cursor, setCursor] = useState(startingCursor);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [depth, setDepth] = useState(14);
  const [multipv, setMultipv] = useState(3);
  const [timeSec, setTimeSec] = useState(1.5);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"fen" | "pgn">("fen");
  const [fenInput, setFenInput] = useState(startingFrames[startingCursor].fen);
  const [pgnInput, setPgnInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const notationRef = useRef<HTMLDivElement>(null);

  const current = frames[cursor];
  const currentFen = current.fen;
  const sideToMove = currentFen.split(" ")[1] === "b" ? "black" : "white";
  const topLine = result?.lines[0];
  const evaluation = topLine?.whiteCp ?? 0;
  const arrows = topLine?.bestMoveUci ? [{
    startSquare: topLine.bestMoveUci.slice(0, 2),
    endSquare: topLine.bestMoveUci.slice(2, 4),
    color: "#65a30d",
  }] : [];

  const analyzePosition = useCallback(async () => {
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/position-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: currentFen, depth, multipv, timeSec }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === "analysis_superseded") return;
        throw new Error(data.detail ?? data.error ?? "analysis_failed");
      }
      if (id === requestId.current) setResult(data as AnalysisResult);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (id === requestId.current) {
        setError(caught instanceof Error ? caught.message : "Stockfish analysis failed.");
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [currentFen, depth, multipv, timeSec]);

  useEffect(() => {
    if (!autoAnalyze) return;
    const timer = window.setTimeout(() => void analyzePosition(), 300);
    return () => window.clearTimeout(timer);
  }, [analyzePosition, autoAnalyze]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const container = notationRef.current;
    const currentMove = container?.querySelector<HTMLElement>(
      '[data-current="true"]',
    );
    if (!container || !currentMove) return;
    const containerRect = container.getBoundingClientRect();
    const currentRect = currentMove.getBoundingClientRect();
    container.scrollTo({
      top:
        container.scrollTop +
        currentRect.top -
        containerRect.top -
        container.clientHeight / 2 +
        currentRect.height / 2,
      behavior: "smooth",
    });
  }, [cursor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const targetIndex = Math.max(0, cursor - 1);
        setCursor(targetIndex);
        setFenInput(frames[targetIndex].fen);
        setResult(null);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const targetIndex = Math.min(frames.length - 1, cursor + 1);
        setCursor(targetIndex);
        setFenInput(frames[targetIndex].fen);
        setResult(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cursor, frames]);

  function playMove(uci: string) {
    const chess = new Chess(currentFen);
    try {
      const fullMove = Number(chess.fen().split(" ")[5] ?? "1");
      const blackToMove = chess.turn() === "b";
      const played = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
      const beforeLabel = blackToMove ? `${fullMove}... ${played.san}` : `${fullMove}. ${played.san}`;
      const move = chess.history({ verbose: true }).at(-1);
      if (!move) return;
      const nextFrame: AnalysisPositionFrame = {
        fen: chess.fen(),
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        san: move.san,
        label: beforeLabel,
      };
      const nextFrames = [...frames.slice(0, cursor + 1), nextFrame];
      setFrames(nextFrames);
      setCursor(nextFrames.length - 1);
      setFenInput(nextFrame.fen);
      setResult(null);
      setError(null);
    } catch {
      // Board interaction simply snaps back for an illegal move.
    }
  }

  function loadFen() {
    try {
      const chess = new Chess(fenInput.trim());
      setFrames([{ fen: chess.fen(), uci: null, san: null, label: "Loaded position" }]);
      setCursor(0);
      setResult(null);
      setLoadError(null);
    } catch {
      setLoadError("That FEN is not a valid chess position.");
    }
  }

  function loadPgn() {
    try {
      const loaded = positionFramesFromPgn(pgnInput.trim());
      setFrames(loaded);
      setCursor(loaded.length - 1);
      setFenInput(loaded.at(-1)?.fen ?? START_FEN);
      setResult(null);
      setLoadError(null);
    } catch {
      setLoadError("That PGN could not be parsed.");
    }
  }

  function resetBoard() {
    setFrames(startingFrames);
    setCursor(startingCursor);
    setFenInput(startingFrames[startingCursor].fen);
    setResult(null);
    setLoadError(null);
  }

  const moveRows = useMemo(
    () => Array.from({ length: Math.ceil((frames.length - 1) / 2) }, (_, index) => ({
      white: frames[index * 2 + 1],
      black: frames[index * 2 + 2],
      number: index + 1,
    })),
    [frames],
  );

  function navigateToPosition(index: number) {
    const target = Math.max(0, Math.min(frames.length - 1, index));
    setCursor(target);
    setFenInput(frames[target].fen);
    setResult(null);
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(520px,0.98fr)_minmax(430px,1.02fr)]">
      <section className="xl:sticky xl:top-20">
        <div className="mx-auto w-full max-w-[720px] xl:w-[calc(100vh-12.5rem)] xl:max-w-full">
          <div className="mb-2 flex items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-sm dark:border-stone-700 dark:bg-stone-900">
            <div><p className="text-sm font-black text-stone-900 dark:text-stone-50">{sideToMove === "white" ? "White" : "Black"} to move</p><p className="text-[11px] text-stone-400">Move {cursor} of {frames.length - 1}</p></div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setOrientation((value) => value === "white" ? "black" : "white"); }} className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-600 hover:border-emerald-400 dark:border-stone-700 dark:text-stone-300" title="Flip board">↻ Flip</button>
              <button type="button" onClick={resetBoard} className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-600 hover:border-rose-400 dark:border-stone-700 dark:text-stone-300">Reset</button>
            </div>
          </div>
          <div className="grid grid-cols-[34px_minmax(0,1fr)] items-stretch gap-2">
            <EvaluationBar cp={evaluation} />
            <div className="overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700">
              <Board
                key={`analysis-${cursor}-${orientation}`}
                fen={currentFen}
                orientation={orientation}
                highlight={current.uci ? [current.uci.slice(0, 2), current.uci.slice(2, 4)] : []}
                arrows={arrows}
                allowDrawingArrows
                onMove={playMove}
              />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {[{ label: "|←", title: "Starting position", target: 0, disabled: cursor === 0 }, { label: "←", title: "Previous move", target: cursor - 1, disabled: cursor === 0 }, { label: "→", title: "Next move", target: cursor + 1, disabled: cursor === frames.length - 1 }, { label: "→|", title: "Latest position", target: frames.length - 1, disabled: cursor === frames.length - 1 }].map((control) => (
              <button key={control.title} type="button" onClick={() => navigateToPosition(control.target)} disabled={control.disabled} title={control.title} aria-label={control.title} className="rounded-xl border border-stone-200 bg-white py-2 text-sm font-black text-stone-600 shadow-sm disabled:opacity-35 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">{control.label}</button>
            ))}
          </div>
        </div>
      </section>

      <aside className="flex min-h-[720px] flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900 xl:h-[calc(100vh-8.5rem)] xl:min-h-0">
        <div className="shrink-0 border-b border-stone-100 p-5 dark:border-stone-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">{result?.engine ?? "Local Stockfish"}</p>
              <div className="mt-1 flex items-baseline gap-2"><h2 className="text-3xl font-black text-stone-900 dark:text-stone-50">{topLine ? lineEvaluation(topLine) : "—"}</h2><span className="text-xs text-stone-400">White evaluation</span></div>
            </div>
            <button type="button" onClick={() => void analyzePosition()} disabled={busy} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60">{busy ? "Analyzing…" : "Analyze now"}</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-[11px] font-semibold text-stone-500">Depth<select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">{[10, 12, 14, 16, 18, 20, 22].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[11px] font-semibold text-stone-500">Lines<select value={multipv} onChange={(event) => setMultipv(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">{[1, 2, 3, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[11px] font-semibold text-stone-500">Time<select value={timeSec} onChange={(event) => setTimeSec(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">{[[0.5, "0.5s"], [1, "1s"], [1.5, "1.5s"], [3, "3s"], [5, "5s"], [10, "10s"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="flex items-end"><button type="button" onClick={() => setAutoAnalyze((value) => !value)} aria-pressed={autoAnalyze} className={`w-full rounded-lg border px-2 py-1.5 text-xs font-bold ${autoAnalyze ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "border-stone-200 text-stone-500 dark:border-stone-700"}`}>{autoAnalyze ? "● Auto" : "○ Manual"}</button></label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><strong className="block">Stockfish could not analyze this position</strong><span className="mt-1 block text-xs opacity-80">{error}</span></div> : null}
          {!result && !error ? <div className="rounded-2xl border border-dashed border-stone-200 p-6 text-center dark:border-stone-700"><div className={`mx-auto grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 ${busy ? "animate-pulse" : ""}`}>♞</div><p className="mt-3 text-sm font-bold text-stone-800 dark:text-stone-100">{busy ? "Stockfish is calculating" : "Ready to analyze"}</p><p className="mt-1 text-xs leading-5 text-stone-500">Play a move or load a position. New searches replace older ones.</p></div> : null}
          {result ? (
            <div className="space-y-2">
              {result.lines.map((line) => (
                <article key={line.rank} className="rounded-2xl border border-stone-200 p-3 dark:border-stone-700">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${line.rank === 1 ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}>{line.rank}</span>
                    <button type="button" disabled={!line.bestMoveUci} onClick={() => { if (line.bestMoveUci) playMove(line.bestMoveUci); }} className="min-w-16 text-left text-lg font-black text-stone-900 hover:text-emerald-700 disabled:opacity-50 dark:text-stone-50 dark:hover:text-emerald-400">{line.bestMoveSan ?? "—"}</button>
                    <span className="ml-auto rounded-lg bg-stone-100 px-2 py-1 font-mono text-xs font-bold text-stone-700 dark:bg-stone-800 dark:text-stone-200">{lineEvaluation(line)}</span>
                  </div>
                  <p className="mt-2 break-words font-mono text-xs leading-5 text-stone-500">{line.pvSan.join(" ")}</p>
                </article>
              ))}
            </div>
          ) : null}

          <section className="mt-4 rounded-2xl border border-stone-200 dark:border-stone-700">
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 dark:border-stone-800"><h3 className="text-sm font-black text-stone-900 dark:text-stone-50">Move notation</h3><span className="text-xs text-stone-400">← → keys</span></div>
            <div ref={notationRef} className="max-h-36 overflow-y-auto p-2">
              {moveRows.length ? <div className="grid grid-cols-[32px_1fr_1fr] gap-1 text-sm">{moveRows.map((row) => <div key={row.number} className="col-span-3 grid grid-cols-[32px_1fr_1fr] gap-1"><span className="px-1 py-1.5 text-right font-mono text-xs text-stone-400">{row.number}.</span>{[row.white, row.black].map((frame, index) => frame ? <button key={frame.label} type="button" data-current={frames[cursor] === frame ? "true" : undefined} onClick={() => navigateToPosition(frames.indexOf(frame))} className={`rounded-lg px-2 py-1.5 text-left font-semibold ${frames[cursor] === frame ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950" : "hover:bg-stone-100 dark:hover:bg-stone-800"}`}>{frame.san}</button> : <span key={index} />)}</div>)}</div> : <p className="p-3 text-center text-xs text-stone-400">Play a move to begin a line.</p>}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-stone-200 p-3 dark:border-stone-700">
            <div className="mb-3 flex gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">{(["fen", "pgn"] as const).map((mode) => <button key={mode} type="button" onClick={() => { setInputMode(mode); setLoadError(null); }} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-bold uppercase ${inputMode === mode ? "bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white" : "text-stone-500"}`}>{mode}</button>)}</div>
            {inputMode === "fen" ? <textarea value={fenInput} onChange={(event) => setFenInput(event.target.value)} rows={3} spellCheck={false} className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 p-3 font-mono text-xs text-stone-700 outline-none focus:border-emerald-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300" aria-label="FEN position" /> : <textarea value={pgnInput} onChange={(event) => setPgnInput(event.target.value)} rows={5} spellCheck={false} placeholder="Paste a PGN game here…" className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 p-3 font-mono text-xs text-stone-700 outline-none focus:border-emerald-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300" aria-label="PGN game" />}
            {loadError ? <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{loadError}</p> : null}
            <button type="button" onClick={inputMode === "fen" ? loadFen : loadPgn} className="mt-2 w-full rounded-xl border border-stone-200 py-2 text-xs font-bold text-stone-600 hover:border-emerald-400 hover:text-emerald-700 dark:border-stone-700 dark:text-stone-300">Load {inputMode.toUpperCase()}</button>
          </section>
        </div>
      </aside>
    </div>
  );
}
