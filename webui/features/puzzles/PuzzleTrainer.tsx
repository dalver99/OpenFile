"use client";

import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { useMemo, useState } from "react";
import type { PuzzleCard } from "@/domain/puzzles";
import PuzzleGenerator from "@/features/puzzles/PuzzleGenerator";

// react-chessboard's drag-and-drop ids are intentionally client-generated.
const Board = dynamic(() => import("@/components/chess/Board"), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />,
});

type Result = {
  status: "solved" | "revealed";
  uci?: string;
  san?: string | null;
  line?: string[];
};

type Feedback = {
  kind: "ok" | "err" | "info";
  title: string;
  text: string;
};

type SolutionFrame = {
  uci: string;
  san: string;
  label: string;
  fen: string;
};

function titleCase(value: string | null): string {
  if (!value) return "Uncategorized";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function squaresOf(uci?: string | null): string[] {
  return uci && uci.length >= 4 ? [uci.slice(0, 2), uci.slice(2, 4)] : [];
}

function solutionFrames(fen: string, line: string[] | undefined): SolutionFrame[] {
  if (!line?.length) return [];
  const chess = new Chess(fen);
  const frames: SolutionFrame[] = [];
  for (const uci of line) {
    const fullMove = Number(chess.fen().split(" ")[5] ?? "1");
    const blackToMove = chess.turn() === "b";
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
      frames.push({
        uci,
        san: move.san,
        label: blackToMove ? `${fullMove}... ${move.san}` : `${fullMove}. ${move.san}`,
        fen: chess.fen(),
      });
    } catch {
      break;
    }
  }
  return frames;
}

function puzzleState(puzzle: PuzzleCard, result: Result | undefined): "todo" | "solved" | "revealed" {
  if (result?.status) return result.status;
  if (puzzle.progress_status === "solved" || puzzle.progress_status === "revealed") return puzzle.progress_status;
  return "todo";
}

export default function PuzzleTrainer({ puzzles, demo = false }: { puzzles: PuzzleCard[]; demo?: boolean }) {
  const [idx, setIdx] = useState(0);
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [results, setResults] = useState<Record<number, Result>>({});
  const [attempts, setAttempts] = useState<Record<number, number>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [solutionPly, setSolutionPly] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingFen, setPendingFen] = useState<string | null>(null);

  const solvedCount = useMemo(
    () => puzzles.filter((puzzle) => puzzleState(puzzle, results[puzzle.id]) === "solved").length,
    [puzzles, results],
  );
  const visiblePuzzles = useMemo(
    () => puzzles.filter((puzzle) => {
      const phaseMatches = phaseFilter === "all" || puzzle.phase === phaseFilter;
      const state = puzzleState(puzzle, results[puzzle.id]);
      const statusMatches = statusFilter === "all" ||
        (statusFilter === "todo" ? state === "todo" : state !== "todo");
      return phaseMatches && statusMatches;
    }),
    [phaseFilter, puzzles, results, statusFilter],
  );

  if (!puzzles.length) {
    return <PuzzleGenerator />;
  }

  const activeIndex = Math.min(idx, Math.max(visiblePuzzles.length - 1, 0));
  const puzzle = visiblePuzzles[activeIndex];

  function clearPositionUi() {
    setFeedback(null);
    setLastAttempt(null);
    setSolutionPly(0);
    setPendingFen(null);
  }

  function changeFilter(kind: "phase" | "status", value: string) {
    if (kind === "phase") setPhaseFilter(value);
    else setStatusFilter(value);
    setIdx(0);
    clearPositionUi();
  }

  if (!puzzle) {
    return (
      <div className="space-y-5">
        <QueueHeader
          puzzles={puzzles}
          solvedCount={solvedCount}
          phaseFilter={phaseFilter}
          statusFilter={statusFilter}
          onFilter={changeFilter}
        />
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center dark:border-stone-700 dark:bg-stone-900">
          <h2 className="text-lg font-black text-stone-900 dark:text-stone-50">No puzzles match these filters</h2>
          <button type="button" onClick={() => { setPhaseFilter("all"); setStatusFilter("all"); }} className="mt-3 text-sm font-bold text-brand-700 hover:underline dark:text-brand-400">Clear filters</button>
        </div>
      </div>
    );
  }

  const result = results[puzzle.id];
  const done = Boolean(result);
  const persistedState = puzzleState(puzzle, result);
  const side = puzzle.side_to_move === "white" ? "White" : "Black";
  const goal = puzzle.is_mate
    ? `Find the forced mate${puzzle.mate_in ? ` in ${puzzle.mate_in}` : ""}`
    : `Find the best move for ${side}`;
  const frames = solutionFrames(puzzle.fen_before, result?.line);
  const shownFrame = solutionPly > 0 ? frames[solutionPly - 1] : null;
  const boardFen = shownFrame?.fen ?? pendingFen ?? puzzle.fen_before;
  const highlightedMove = shownFrame?.uci ?? (done ? result?.uci : lastAttempt);
  const sessionAttempts = attempts[puzzle.id] ?? 0;

  async function submit(payload: { moveUci?: string; reveal?: boolean }) {
    if (busy || done) return;
    setBusy(true);
    if (payload.reveal) {
      setFeedback({
        kind: "info",
        title: "Loading the solution…",
        text: "Fetching the saved engine line for this position.",
      });
    }
    try {
      const response = await fetch("/api/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puzzleId: puzzle.id, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "attempt_failed");
      if (data.revealed) {
        setResults((current) => ({
          ...current,
          [puzzle.id]: { status: "revealed", uci: data.solutionUci, san: data.solutionSan, line: data.line },
        }));
        setSolutionPly(1);
        setFeedback({ kind: "info", title: "Solution revealed", text: `The best move is ${data.solutionSan ?? data.solutionUci}. Play through the line below.` });
      } else if (data.correct) {
        setResults((current) => ({
          ...current,
          [puzzle.id]: { status: "solved", uci: data.solutionUci, san: data.solutionSan, line: data.line },
        }));
        setSolutionPly(1);
        setFeedback({ kind: "ok", title: "Correct", text: `${data.solutionSan ?? data.solutionUci} finds the idea. Now inspect the continuation.` });
      } else {
        setAttempts((current) => ({ ...current, [puzzle.id]: (current[puzzle.id] ?? 0) + 1 }));
        setLastAttempt(payload.moveUci ?? null);
        setFeedback({ kind: "err", title: "Not quite", text: "The position has reset. Check forcing moves first: checks, captures, and direct threats." });
      }
    } catch {
      setPendingFen(null);
      setFeedback({ kind: "err", title: "Could not check the move", text: "The request failed. Your puzzle is still here—try again." });
    } finally {
      setPendingFen(null);
      setBusy(false);
    }
  }

  function handleBoardMove(uci: string) {
    if (busy || done) return;
    const chess = new Chess(puzzle.fen_before);
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
      const normalized = `${move.from}${move.to}${move.promotion ?? ""}`;
      setLastAttempt(normalized);
      setPendingFen(chess.fen());
      setFeedback({
        kind: "info",
        title: "Checking your move…",
        text: `${move.san} is on the board while your answer is verified.`,
      });
      void submit({ moveUci: normalized });
    } catch {
      setFeedback({ kind: "err", title: "That move is not legal", text: "The board has reset. Choose another destination square." });
      setLastAttempt(null);
    }
  }

  function go(next: number) {
    setIdx((current) => Math.min(Math.max(current + next, 0), visiblePuzzles.length - 1));
    clearPositionUi();
  }

  const feedbackStyle = feedback?.kind === "ok"
    ? "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200"
    : feedback?.kind === "err"
      ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
      : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200";

  return (
    <div className="space-y-5">
      {demo ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-200">This sample puzzle is fully playable. Progress lasts for this session; generating new puzzles requires the local app.</p> : null}
      <QueueHeader
        puzzles={puzzles}
        solvedCount={solvedCount}
        phaseFilter={phaseFilter}
        statusFilter={statusFilter}
        onFilter={changeFilter}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(480px,680px)_minmax(320px,1fr)]">
        <section className="mx-auto w-full max-w-[680px] lg:sticky lg:top-20">
          <div className="mb-2 flex h-12 items-center justify-between rounded-xl border border-stone-200 bg-white px-3 shadow-sm dark:border-stone-700 dark:bg-stone-900">
            <div className="flex items-center gap-2">
              <span className={`h-5 w-5 rounded-full border ${puzzle.side_to_move === "white" ? "border-stone-300 bg-white" : "border-stone-950 bg-stone-950"}`} />
              <div><p className="text-sm font-bold text-stone-900 dark:text-stone-50">{side} to move</p><p className="text-[11px] text-stone-400">Position from your game</p></div>
            </div>
            <span className="text-xs font-semibold text-stone-500">Puzzle {activeIndex + 1} of {visiblePuzzles.length}</span>
          </div>
          <div className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700">
            <Board
              key={`${puzzle.id}-${sessionAttempts}-${solutionPly}-${done ? "done" : "play"}`}
              fen={boardFen}
              orientation={puzzle.side_to_move}
              disabled={done || busy}
              highlight={squaresOf(highlightedMove)}
              highlightColor={done ? "#22c55e" : lastAttempt ? "#ef4444" : undefined}
              onMove={handleBoardMove}
            />
          </div>
          <p className="mt-2 text-center text-[11px] text-stone-400">Drag or click to move · right-click marks · right-drag arrows.</p>
        </section>

        <aside className="flex min-h-[590px] flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900 lg:min-h-[738px]">
          <div className="border-b border-stone-100 p-5 dark:border-stone-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">Your game · {titleCase(puzzle.phase)}</p>
                <h2 className="mt-1 text-xl font-black text-stone-900 dark:text-stone-50">{goal}</h2>
              </div>
              {persistedState !== "todo" ? (
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${persistedState === "solved" ? "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>{result ? (persistedState === "solved" ? "Solved" : "Revealed") : (persistedState === "solved" ? "Solved before" : "Revealed before")}</span>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {puzzle.tag ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{titleCase(puzzle.tag)}</span> : null}
              {puzzle.themes
                .filter((theme) => titleCase(theme) !== titleCase(puzzle.tag))
                .slice(0, 3)
                .map((theme) => <span key={theme} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">{titleCase(theme)}</span>)}
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">Difficulty {puzzle.difficulty ?? "—"}/5</span>
            </div>
          </div>

          <div className="flex flex-1 flex-col p-5">
            <div className={`min-h-28 rounded-2xl border p-4 ${feedback ? feedbackStyle : "border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/60"}`} aria-live="polite">
              {feedback ? (
                <><p className="font-black">{feedback.title}</p><p className="mt-1 text-sm leading-6 opacity-80">{feedback.text}</p></>
              ) : (
                <><p className="font-black text-stone-900 dark:text-stone-50">Take your time</p><p className="mt-1 text-sm leading-6 text-stone-500">There is no timer. Calculate the opponent&apos;s best reply before you commit.</p></>
              )}
            </div>

            {done ? (
              <div className="mt-5">
                <div className="flex items-center justify-between"><h3 className="text-sm font-black text-stone-900 dark:text-stone-50">Best continuation</h3><span className="text-xs text-stone-400">Click a move to replay</span></div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {frames.map((frame, frameIndex) => (
                    <button key={`${frame.uci}-${frameIndex}`} type="button" onClick={() => setSolutionPly(frameIndex + 1)} className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-bold ${solutionPly === frameIndex + 1 ? "bg-brand-700 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"}`}>{frame.label}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60"><strong className="block text-lg text-stone-900 dark:text-stone-50">{sessionAttempts}</strong><span className="text-[11px] text-stone-400">This session</span></div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60"><strong className="block text-lg text-stone-900 dark:text-stone-50">{puzzle.attempts}</strong><span className="text-[11px] text-stone-400">Past attempts</span></div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60"><strong className="block text-lg text-stone-900 dark:text-stone-50">{puzzle.quality_score ?? "—"}</strong><span className="text-[11px] text-stone-400">Quality</span></div>
              </div>
            )}

            <div className="mt-auto pt-6">
              <div className="mb-4 rounded-xl border border-stone-100 px-3 py-2 text-xs text-stone-500 dark:border-stone-800">
                {[puzzle.opponent_username ? `vs ${puzzle.opponent_username}` : null, puzzle.time_class ? titleCase(puzzle.time_class) : null, puzzle.played_at].filter(Boolean).join(" · ") || "Game details unavailable"}
              </div>
              <div className="grid grid-cols-[auto_1fr_auto] gap-2">
                <button type="button" onClick={() => go(-1)} disabled={activeIndex === 0} className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-bold text-stone-600 disabled:opacity-35 dark:border-stone-700 dark:text-stone-300" aria-label="Previous puzzle">←</button>
                {!done ? (
                  <button type="button" onClick={() => void submit({ reveal: true })} disabled={busy} className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-stone-600 hover:border-amber-400 hover:text-amber-700 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300">{busy ? "Checking…" : "Show solution"}</button>
                ) : (
                  <button type="button" onClick={() => setSolutionPly((current) => current >= frames.length ? 0 : current + 1)} className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-stone-600 hover:border-brand-400 hover:text-brand-700 dark:border-stone-700 dark:text-stone-300">Replay line</button>
                )}
                <button type="button" onClick={() => go(1)} disabled={activeIndex === visiblePuzzles.length - 1} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-35 dark:bg-stone-100 dark:text-stone-950" aria-label="Next puzzle">Next →</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function QueueHeader({
  puzzles,
  solvedCount,
  phaseFilter,
  statusFilter,
  onFilter,
}: {
  puzzles: PuzzleCard[];
  solvedCount: number;
  phaseFilter: string;
  statusFilter: string;
  onFilter: (kind: "phase" | "status", value: string) => void;
}) {
  const progress = puzzles.length ? Math.round((solvedCount / puzzles.length) * 100) : 0;
  const phases = ["all", ...new Set(puzzles.map((puzzle) => puzzle.phase).filter((phase): phase is string => Boolean(phase)))];
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-sm"><strong className="text-stone-900 dark:text-stone-50">Training queue</strong><span className="text-xs text-stone-500">{solvedCount} solved · {puzzles.length - solvedCount} remaining</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="flex gap-2">
          <select value={phaseFilter} onChange={(event) => onFilter("phase", event.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600 outline-none focus:border-brand-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300" aria-label="Filter puzzles by phase">
            {phases.map((phase) => <option key={phase} value={phase}>{phase === "all" ? "All phases" : titleCase(phase)}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => onFilter("status", event.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600 outline-none focus:border-brand-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300" aria-label="Filter puzzles by status">
            <option value="all">All puzzles</option><option value="todo">To solve</option><option value="completed">Completed</option>
          </select>
        </div>
      </div>
    </section>
  );
}
