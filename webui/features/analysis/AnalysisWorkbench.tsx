"use client";

import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEvaluation } from "@/lib/review";
import EvaluationBar from "@/components/chess/EvaluationBar";
import { lichessAnalysisUrl } from "@/lib/lichess";
import PositionEditor from "@/features/analysis/PositionEditor";

const Board = dynamic(() => import("@/components/chess/Board"), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse bg-stone-200 dark:bg-stone-800" />,
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

type PositionNode = AnalysisPositionFrame & {
  id: string;
  parentId: string | null;
  childIds: string[];
};

function nodesFromFrames(frames: AnalysisPositionFrame[]): PositionNode[] {
  return frames.map((frame, index) => ({
    ...frame,
    id: `initial-${index}`,
    parentId: index ? `initial-${index - 1}` : null,
    childIds: index + 1 < frames.length ? [`initial-${index + 1}`] : [],
  }));
}

function pathToNode(nodes: PositionNode[], nodeId: string): PositionNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: PositionNode[] = [];
  let node = byId.get(nodeId);
  while (node) {
    path.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return path;
}

function mainlineLeaf(nodes: PositionNode[], startId: string): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = byId.get(startId);
  while (node?.childIds[0]) node = byId.get(node.childIds[0]);
  return node?.id ?? startId;
}

function PlayedVariationTree({
  nodes,
  cursorId,
  onSelect,
}: {
  nodes: PositionNode[];
  cursorId: string;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = nodes.find((node) => node.parentId === null);
  if (!root?.childIds.length) {
    return <p className="px-3 py-4 text-center text-xs text-stone-400">Play a move to start a variation.</p>;
  }

  function sequence(startId: string, depth: number): React.ReactNode {
    const line: PositionNode[] = [];
    let node = byId.get(startId);
    while (node) {
      line.push(node);
      if (node.childIds.length !== 1) break;
      node = byId.get(node.childIds[0]);
    }
    const tail = line.at(-1);
    return (
      <div key={startId} className={depth ? "ml-3 border-l border-stone-200 pl-2 dark:border-stone-700" : ""}>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 py-1">
          {line.map((move) => (
            <button
              key={move.id}
              type="button"
              data-current={move.id === cursorId ? "true" : undefined}
              onClick={() => onSelect(move.id)}
              className={`rounded px-1.5 py-0.5 text-xs font-semibold transition ${move.id === cursorId ? "bg-brand-700 text-white" : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"}`}
            >
              {move.label}
            </button>
          ))}
        </div>
        {tail && tail.childIds.length > 1 ? (
          <div>{tail.childIds.map((childId) => sequence(childId, depth + 1))}</div>
        ) : null}
      </div>
    );
  }

  return <div className="p-2">{root.childIds.map((childId) => sequence(childId, root.childIds.length > 1 ? 1 : 0))}</div>;
}

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

function compactPv(line: EngineLine): string {
  const first = line.pvSan[0] ?? "";
  const startsWithBest = Boolean(
    line.bestMoveSan
    && (first === line.bestMoveSan || first.endsWith(` ${line.bestMoveSan}`)),
  );
  const continuation = line.pvSan.slice(startsWithBest ? 1 : 0);
  const visible = continuation.slice(0, 8).join(" ");
  return continuation.length > 8 ? `${visible} …` : visible;
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
  demo = false,
}: {
  initialFrames?: AnalysisPositionFrame[];
  initialCursor?: number;
  demo?: boolean;
}) {
  const startingFrames = useMemo(() => initialFrames?.length
    ? initialFrames
    : [{ fen: START_FEN, uci: null, san: null, label: "Start" }], [initialFrames]);
  const startingCursor = Math.max(
    0,
    Math.min(startingFrames.length - 1, initialCursor),
  );
  const startingNodes = useMemo(() => nodesFromFrames(startingFrames), [startingFrames]);
  const [nodes, setNodes] = useState<PositionNode[]>(startingNodes);
  const [cursorId, setCursorId] = useState(startingNodes[startingCursor].id);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [depth, setDepth] = useState(14);
  const [multipv, setMultipv] = useState(3);
  const [timeSec, setTimeSec] = useState(1.5);
  const [autoAnalyze, setAutoAnalyze] = useState(!demo);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"fen" | "pgn">("fen");
  const [fenInput, setFenInput] = useState(startingFrames[startingCursor].fen);
  const [pgnInput, setPgnInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const notationRef = useRef<HTMLDivElement>(null);
  const nextNodeId = useRef(startingNodes.length);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const current = nodeById.get(cursorId) ?? nodes[0];
  const frames = useMemo(() => pathToNode(nodes, current.id), [current.id, nodes]);
  const cursor = frames.length - 1;
  const currentFen = current.fen;
  const sideToMove = currentFen.split(" ")[1] === "b" ? "black" : "white";
  const topLine = result?.lines[0];
  const evaluation = topLine?.whiteCp ?? 0;
  const lichessHref = lichessAnalysisUrl(currentFen, orientation);
  const arrows = topLine?.bestMoveUci ? [{
    startSquare: topLine.bestMoveUci.slice(0, 2),
    endSquare: topLine.bestMoveUci.slice(2, 4),
    color: "#65a30d",
  }] : [];

  const navigateToNode = useCallback((id: string) => {
    const target = nodeById.get(id);
    if (!target) return;
    setCursorId(target.id);
    setFenInput(target.fen);
    setResult(null);
  }, [nodeById]);

  const analyzePosition = useCallback(async () => {
    if (demo) {
      setError("Hosted demo: connect the local app to run Stockfish analysis.");
      return;
    }
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
  }, [currentFen, demo, depth, multipv, timeSec]);

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
  }, [cursorId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (current.parentId) navigateToNode(current.parentId);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (current.childIds[0]) navigateToNode(current.childIds[0]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [current, navigateToNode]);

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
      const existing = current.childIds
        .map((id) => nodeById.get(id))
        .find((node) => node?.uci === nextFrame.uci);
      if (existing) {
        setCursorId(existing.id);
        setFenInput(existing.fen);
        setResult(null);
        setError(null);
        return;
      }
      const id = `variation-${nextNodeId.current++}`;
      const nextNode: PositionNode = {
        ...nextFrame,
        id,
        parentId: current.id,
        childIds: [],
      };
      setNodes((tree) => [
        ...tree.map((node) => node.id === current.id
          ? { ...node, childIds: [...node.childIds, id] }
          : node),
        nextNode,
      ]);
      setCursorId(id);
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
      const loaded = nodesFromFrames([{ fen: chess.fen(), uci: null, san: null, label: "Loaded position" }]);
      setNodes(loaded);
      setCursorId(loaded[0].id);
      nextNodeId.current = loaded.length;
      setResult(null);
      setLoadError(null);
    } catch {
      setLoadError("That FEN is not a valid chess position.");
    }
  }

  function loadPgn() {
    try {
      const loaded = positionFramesFromPgn(pgnInput.trim());
      const loadedNodes = nodesFromFrames(loaded);
      setNodes(loadedNodes);
      setCursorId(loadedNodes.at(-1)?.id ?? loadedNodes[0].id);
      nextNodeId.current = loadedNodes.length;
      setFenInput(loaded.at(-1)?.fen ?? START_FEN);
      setResult(null);
      setLoadError(null);
    } catch {
      setLoadError("That PGN could not be parsed.");
    }
  }

  function resetBoard() {
    setNodes(startingNodes);
    setCursorId(startingNodes[startingCursor].id);
    nextNodeId.current = startingNodes.length;
    setFenInput(startingFrames[startingCursor].fen);
    setResult(null);
    setLoadError(null);
  }

  function useEditedPosition(fen: string) {
    const loaded = nodesFromFrames([{ fen, uci: null, san: null, label: "Edited position" }]);
    setNodes(loaded);
    setCursorId(loaded[0].id);
    nextNodeId.current = loaded.length;
    setFenInput(fen);
    setResult(null);
    setError(null);
    setLoadError(null);
    setEditorOpen(false);
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(640px,1.35fr)_minmax(400px,0.65fr)] 2xl:grid-cols-[minmax(760px,1.45fr)_minmax(430px,0.55fr)]">
      <section className="xl:sticky xl:top-20">
        <div className="mx-auto w-full max-w-[920px] xl:w-[min(calc(100dvh-10.5rem),100%)] xl:max-w-full">
          <div className="mb-2 flex items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-sm dark:border-stone-700 dark:bg-stone-900">
            <div><p className="text-sm font-black text-stone-900 dark:text-stone-50">{sideToMove === "white" ? "White" : "Black"} to move</p><p className="text-[11px] text-stone-400">Ply {cursor} · {nodes.length - 1} moves in tree</p></div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setEditorOpen(true)} className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:border-brand-500 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-300" title="Place pieces and choose the side to move">✎ Edit position</button>
              <a href={lichessHref} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-600 hover:border-brand-400 hover:text-brand-700 dark:border-stone-700 dark:text-stone-300" title="Open this exact position in Lichess">Lichess ↗</a>
              <button type="button" onClick={() => { setOrientation((value) => value === "white" ? "black" : "white"); }} className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-600 hover:border-brand-400 dark:border-stone-700 dark:text-stone-300" title="Flip board">↻ Flip</button>
              <button type="button" onClick={resetBoard} className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-600 hover:border-rose-400 dark:border-stone-700 dark:text-stone-300">Reset</button>
            </div>
          </div>
          <div className="grid grid-cols-[34px_minmax(0,1fr)] items-stretch gap-2">
            <EvaluationBar cp={evaluation} />
            <div className="overflow-hidden bg-white shadow-lg ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700">
              <Board
                key={`analysis-${cursorId}-${orientation}`}
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
            {[
              { label: "|←", title: "Starting position", target: nodes[0].id, disabled: current.parentId === null },
              { label: "←", title: "Previous move", target: current.parentId ?? current.id, disabled: current.parentId === null },
              { label: "→", title: "Next move", target: current.childIds[0] ?? current.id, disabled: !current.childIds.length },
              { label: "→|", title: "End of this variation", target: mainlineLeaf(nodes, current.id), disabled: !current.childIds.length },
            ].map((control) => (
              <button key={control.title} type="button" onClick={() => navigateToNode(control.target)} disabled={control.disabled} title={control.title} aria-label={control.title} className="rounded-xl border border-stone-200 bg-white py-2 text-sm font-black text-stone-600 shadow-sm disabled:opacity-35 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">{control.label}</button>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-stone-400">Right-click marks a square · right-drag draws or removes an arrow.</p>
        </div>
      </section>

      <aside className="flex min-h-[720px] flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900 xl:h-[calc(100dvh-9rem)] xl:min-h-0">
        <div className="shrink-0 border-b border-stone-100 p-3 dark:border-stone-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">{demo ? "Demo board" : result?.engine ?? "Local Stockfish"}</p>
              <div className="flex items-baseline gap-2"><h2 className="text-2xl font-black text-stone-900 dark:text-stone-50">{topLine ? lineEvaluation(topLine) : "—"}</h2><span className="text-[11px] text-stone-400">White</span></div>
            </div>
            <button type="button" onClick={() => void analyzePosition()} disabled={busy || demo} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-60">{demo ? "Desktop only" : busy ? "Analyzing…" : "Analyze"}</button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <label className="text-[10px] font-semibold text-stone-500">Depth<select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="mt-0.5 block w-full rounded-md border border-stone-200 bg-white px-1.5 py-1 text-[11px] text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">{[10, 12, 14, 16, 18, 20, 22].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[10px] font-semibold text-stone-500">Branches<select value={multipv} onChange={(event) => setMultipv(Number(event.target.value))} className="mt-0.5 block w-full rounded-md border border-stone-200 bg-white px-1.5 py-1 text-[11px] text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">{[1, 2, 3, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-[10px] font-semibold text-stone-500">Time<select value={timeSec} onChange={(event) => setTimeSec(Number(event.target.value))} className="mt-0.5 block w-full rounded-md border border-stone-200 bg-white px-1.5 py-1 text-[11px] text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">{[[0.5, "0.5s"], [1, "1s"], [1.5, "1.5s"], [3, "3s"], [5, "5s"], [10, "10s"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="flex items-end"><button type="button" disabled={demo} onClick={() => setAutoAnalyze((value) => !value)} aria-pressed={autoAnalyze} className={`w-full rounded-md border px-1.5 py-1 text-[11px] font-bold disabled:opacity-40 ${autoAnalyze ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "border-stone-200 text-stone-500 dark:border-stone-700"}`}>{demo ? "Demo" : autoAnalyze ? "● Auto" : "○ Manual"}</button></label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {demo ? <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-200">Move pieces, edit the board, import FEN/PGN, and build variation trees. Live evaluations require local Stockfish.</div> : null}
          {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><strong>Analysis failed:</strong> {error}</div> : null}

          <section className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 dark:border-stone-800"><h3 className="text-xs font-black text-stone-900 dark:text-stone-50">Engine branches</h3><span className="text-[10px] text-stone-400">click first move to play</span></div>
            {result ? (
              <div className="divide-y divide-stone-100 dark:divide-stone-800" role="tree">
              {result.lines.map((line) => (
                <div key={line.rank} role="treeitem" aria-selected={line.rank === 1} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 px-3 py-2 text-xs">
                  <span className="font-mono font-bold text-stone-500">{lineEvaluation(line)}</span>
                  <div className="min-w-0 border-l border-stone-200 pl-2 dark:border-stone-700">
                    <button type="button" disabled={!line.bestMoveUci} onClick={() => { if (line.bestMoveUci) playMove(line.bestMoveUci); }} className="mr-1 font-black text-stone-900 hover:text-brand-700 disabled:opacity-50 dark:text-stone-50 dark:hover:text-brand-400">{line.bestMoveSan ?? "—"}</button>
                    <span className="leading-5 text-stone-500">{compactPv(line)}</span>
                  </div>
                </div>
              ))}
              </div>
            ) : <p className={`px-3 py-3 text-xs text-stone-400 ${busy ? "animate-pulse" : ""}`}>{busy ? "Stockfish is calculating…" : "Play a move or choose Analyze."}</p>}
          </section>

          <section className="mt-3 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 dark:border-stone-800"><h3 className="text-xs font-black text-stone-900 dark:text-stone-50">Move tree</h3><span className="text-[10px] text-stone-400">← → navigate</span></div>
            <div ref={notationRef} className="max-h-64 overflow-y-auto">
              <PlayedVariationTree nodes={nodes} cursorId={cursorId} onSelect={navigateToNode} />
            </div>
          </section>

          <details className="mt-3 rounded-xl border border-stone-200 dark:border-stone-700">
            <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-stone-500">Load FEN or PGN</summary>
            <div className="border-t border-stone-100 p-3 dark:border-stone-800">
              <div className="mb-3 flex gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">{(["fen", "pgn"] as const).map((mode) => <button key={mode} type="button" onClick={() => { setInputMode(mode); setLoadError(null); }} className={`flex-1 rounded-md px-2 py-1 text-[11px] font-bold uppercase ${inputMode === mode ? "bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white" : "text-stone-500"}`}>{mode}</button>)}</div>
              {inputMode === "fen" ? <textarea value={fenInput} onChange={(event) => setFenInput(event.target.value)} rows={3} spellCheck={false} className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50 p-2 font-mono text-xs text-stone-700 outline-none focus:border-brand-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300" aria-label="FEN position" /> : <textarea value={pgnInput} onChange={(event) => setPgnInput(event.target.value)} rows={5} spellCheck={false} placeholder="Paste a PGN game here…" className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50 p-2 font-mono text-xs text-stone-700 outline-none focus:border-brand-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300" aria-label="PGN game" />}
              {loadError ? <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{loadError}</p> : null}
              <button type="button" onClick={inputMode === "fen" ? loadFen : loadPgn} className="mt-2 w-full rounded-lg border border-stone-200 py-1.5 text-xs font-bold text-stone-600 hover:border-brand-400 hover:text-brand-700 dark:border-stone-700 dark:text-stone-300">Load {inputMode.toUpperCase()}</button>
            </div>
          </details>
        </div>
      </aside>
      {editorOpen ? <PositionEditor initialFen={currentFen} orientation={orientation} onCancel={() => setEditorOpen(false)} onApply={useEditedPosition} /> : null}
    </div>
  );
}
