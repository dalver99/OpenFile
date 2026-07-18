"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GameReview as GameReviewData,
  ReviewMove,
  ReviewSideline,
} from "@/domain/games";
import {
  accuracyFor,
  candidateMove,
  classificationMeta,
  formatEvaluation,
  gameHeadline,
  moveComment,
  moveToSan,
  whiteEvaluation,
} from "@/lib/review";
import EvaluationBar from "@/components/chess/EvaluationBar";
import EvaluationGraph from "@/components/chess/EvaluationGraph";

const Board = dynamic(() => import("@/components/chess/Board"), {
  ssr: false,
  loading: () => (
    <div className="aspect-square w-full animate-pulse rounded-xl bg-stone-200 dark:bg-stone-800" />
  ),
});

type BookMoveInfo = {
  ply: number;
  book: boolean;
  games: number;
  eco: string | null;
  openingName: string | null;
};

type ActiveSideline = Omit<ReviewSideline, "id"> & {
  id: number | null;
  fens: string[];
  cursor: number;
};

type RetryState = {
  targetPly: number;
  status: "trying" | "wrong" | "correct" | "revealed";
  attempts: number;
  lastMoveUci: string | null;
  lastMoveSan: string | null;
};

let moveAudioContext: AudioContext | null = null;

function emitMoveSound(capture: boolean) {
  moveAudioContext ??= new AudioContext();
  const context = moveAudioContext;
  if (context.state === "suspended") void context.resume();
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = capture ? "square" : "triangle";
  oscillator.frequency.setValueAtTime(capture ? 128 : 210, now);
  oscillator.frequency.exponentialRampToValueAtTime(capture ? 82 : 165, now + 0.07);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(capture ? 0.09 : 0.055, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (capture ? 0.12 : 0.085));
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (capture ? 0.13 : 0.095));
}

function squarePair(uci: string | null): string[] {
  return uci && uci.length >= 4 ? [uci.slice(0, 2), uci.slice(2, 4)] : [];
}

function positionAfter(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    const chess = new Chess(fen);
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || "q",
    });
    return chess.fen();
  } catch {
    return null;
  }
}

function moveLabel(move: ReviewMove): string {
  return `${move.move_number}${move.side === "black" ? "..." : "."} ${move.san}`;
}

function countClassifications(
  moves: ReviewMove[],
  side: "white" | "black",
  bookMoves: Record<number, BookMoveInfo>,
) {
  const counts: Record<string, number> = {};
  moves.filter((move) => move.side === side).forEach((move) => {
    const key = bookMoves[move.ply]?.book ? "book" : move.classification;
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

function hydrateSideline(sideline: ReviewSideline): ActiveSideline {
  const chess = new Chess(sideline.start_fen);
  const fens = [sideline.start_fen];
  for (const uci of sideline.moves_uci) {
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || "q",
    });
    fens.push(chess.fen());
  }
  return { ...sideline, fens, cursor: sideline.moves_uci.length };
}

function sidelineNotation(sideline: ReviewSideline): string[] {
  const fields = sideline.start_fen.split(/\s+/);
  let side = fields[1] === "b" ? "black" : "white";
  let moveNumber = Number.parseInt(fields[5] ?? "1", 10) || 1;

  return sideline.moves_san.map((san) => {
    const token = side === "white"
      ? `${moveNumber}. ${san}`
      : `${moveNumber}... ${san}`;
    if (side === "black") moveNumber += 1;
    side = side === "white" ? "black" : "white";
    return token;
  });
}

const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9 } as const;
const initialPieces = { p: 8, n: 2, b: 2, r: 2, q: 1 } as const;
type MaterialColor = "white" | "black";

function materialStatus(fen: string): Record<MaterialColor, { captured: string; advantage: number }> {
  const counts: Record<MaterialColor, Record<keyof typeof pieceValues, number>> = {
    white: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    black: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const symbol of fen.split(" ")[0]) {
    const type = symbol.toLowerCase() as keyof typeof pieceValues;
    if (!(type in pieceValues)) continue;
    counts[symbol === symbol.toUpperCase() ? "white" : "black"][type] += 1;
  }
  const material = (color: MaterialColor) =>
    (Object.keys(pieceValues) as Array<keyof typeof pieceValues>)
      .reduce((total, type) => total + counts[color][type] * pieceValues[type], 0);
  const difference = material("white") - material("black");
  const icons: Record<MaterialColor, Record<keyof typeof pieceValues, string>> = {
    white: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕" },
    black: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" },
  };
  const capturedBy = (color: MaterialColor) => {
    const victim: MaterialColor = color === "white" ? "black" : "white";
    return (["q", "r", "b", "n", "p"] as const)
      .map((type) => icons[victim][type].repeat(initialPieces[type] - counts[victim][type]))
      .join("");
  };
  return {
    white: { captured: capturedBy("white"), advantage: Math.max(0, difference) },
    black: { captured: capturedBy("black"), advantage: Math.max(0, -difference) },
  };
}

function PlayerStrip({
  name,
  rating,
  accuracy,
  color,
  captured,
  advantage,
}: {
  name: string;
  rating: number | null;
  accuracy: number;
  color: "white" | "black";
  captured: string;
  advantage: number;
}) {
  return (
    <div className="flex h-12 items-center justify-between rounded-xl bg-white px-3 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-sm font-bold text-white">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-50">{name}</p>
          <p className="flex items-center gap-2 text-xs text-stone-400">
            <span>{rating ?? "Unrated"}</span>
            {captured ? <span className="tracking-[-0.08em] text-stone-600 dark:text-stone-300" title="Captured material">{captured}</span> : null}
            {advantage > 0 ? <strong className="text-emerald-700 dark:text-emerald-400">+{advantage}</strong> : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <strong className="rounded-lg bg-stone-100 px-2 py-1 text-sm text-stone-800 dark:bg-stone-800 dark:text-stone-100">
          {accuracy}
        </strong>
        <i
          className={`h-4 w-4 rounded-full border ${
            color === "white"
              ? "border-stone-300 bg-white"
              : "border-stone-900 bg-stone-900"
          }`}
          aria-label={`${color} pieces`}
        />
      </div>
    </div>
  );
}

export default function GameReview({ review }: { review: GameReviewData }) {
  const [selectedIndex, setSelectedIndex] = useState(review.moves.length ? 1 : 0);
  const [savedSidelines, setSavedSidelines] = useState(review.sidelines);
  const [activeSideline, setActiveSideline] = useState<ActiveSideline | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [bookMoves, setBookMoves] = useState<Record<number, BookMoveInfo>>({});
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const notationRef = useRef<HTMLDivElement>(null);

  const selected = selectedIndex > 0 ? review.moves[selectedIndex - 1] : null;
  const game = review.game;
  const selectedBook = selected ? bookMoves[selected.ply] : undefined;
  const effectiveClassification = selectedBook?.book
    ? "book"
    : selected?.classification ?? "unknown";
  const meta =
    classificationMeta[effectiveClassification] ?? classificationMeta.unknown;
  const latestOpening = useMemo(() => {
    const entries = Object.values(bookMoves)
      .filter((entry) => entry.ply <= selectedIndex && entry.openingName)
      .sort((left, right) => left.ply - right.ply);
    return entries.at(-1)?.openingName ?? game.opening;
  }, [bookMoves, game.opening, selectedIndex]);

  const whiteAccuracy = accuracyFor(review.moves, "white");
  const blackAccuracy = accuracyFor(review.moves, "black");
  const playerAccuracy = game.side === "white" ? whiteAccuracy : blackAccuracy;
  const opponentAccuracy = game.side === "white" ? blackAccuracy : whiteAccuracy;
  const playerName =
    game.side === "white" ? game.white_username : game.black_username;
  const opponentName =
    game.side === "white" ? game.black_username : game.white_username;
  const playerRating =
    game.side === "white" ? game.white_rating : game.black_rating;
  const opponentRating =
    game.side === "white" ? game.black_rating : game.white_rating;
  const playerCounts = useMemo(
    () => countClassifications(review.moves, game.side, bookMoves),
    [bookMoves, game.side, review.moves],
  );
  const graphClassifications = useMemo(
    () =>
      Object.fromEntries(
        review.moves.map((move) => [
          move.ply,
          bookMoves[move.ply]?.book ? "book" : move.classification,
        ]),
      ),
    [bookMoves, review.moves],
  );
  const critical = review.moves.filter((move) =>
    ["brilliant", "great", "mistake", "blunder"].includes(move.classification),
  );
  const trainingMoves = useMemo(
    () => review.moves.filter((move) => {
      const suggested = candidateMove(move.top_moves?.[0]);
      return move.side === game.side &&
        ["mistake", "blunder"].includes(move.classification) &&
        Boolean(suggested) &&
        suggested !== move.move_uci;
    }),
    [game.side, review.moves],
  );

  const bestLine = selected?.top_moves?.[0];
  const bestMove = candidateMove(bestLine);
  const bestSan = selected ? moveToSan(selected.fen_before, bestMove) : null;
  const playedMove = selected?.move_uci ?? null;
  const retryActive = Boolean(retry && selected?.ply === retry.targetPly);
  const retryDone = retryActive && (retry?.status === "correct" || retry?.status === "revealed");
  const retryConcealed = retryActive && !retryDone;
  const retryAnswerFen = retryActive && selected
    ? positionAfter(selected.fen_before, bestMove)
    : null;
  const mainBoardFen = selected
    ? selected.fen_after
    : review.moves[0].fen_before;
  const boardFen = retryActive && selected
    ? (retryDone && retryAnswerFen ? retryAnswerFen : selected.fen_before)
    : activeSideline
      ? activeSideline.fens[activeSideline.cursor]
      : mainBoardFen;
  const sidelineLastMove =
    activeSideline && activeSideline.cursor > 0
      ? activeSideline.moves_uci[activeSideline.cursor - 1]
      : null;
  const boardArrowMove = retryActive
    ? (retryDone ? bestMove : null)
    : activeSideline
      ? sidelineLastMove
      : bestMove ?? playedMove;
  const boardArrows = boardArrowMove
    ? [
        {
          startSquare: boardArrowMove.slice(0, 2),
          endSquare: boardArrowMove.slice(2, 4),
          color: activeSideline ? "#38bdf8" : "#65a30d",
        },
      ]
    : [];
  const recordedEvaluation = selected ? whiteEvaluation(selected) : 0;
  const retryLineEvaluation = bestLine?.score_cp == null
    ? null
    : selected?.side === "black"
      ? -bestLine.score_cp
      : bestLine.score_cp;
  const evaluation = retryDone && retryLineEvaluation != null
    ? retryLineEvaluation
    : recordedEvaluation;
  const boardBadge =
    selected && !activeSideline && !retryActive
      ? {
          square: selected.move_uci.slice(2, 4),
          symbol: meta.symbol || "•",
          label: meta.label,
          color: meta.color,
        }
      : null;
  const material = useMemo(() => materialStatus(boardFen), [boardFen]);

  const playMoveSound = useCallback((capture = false) => {
    if (!soundsEnabled) return;
    emitMoveSound(capture);
  }, [soundsEnabled]);

  function goTo(index: number) {
    setActiveSideline(null);
    setRetry(null);
    setSelectedIndex(Math.max(0, Math.min(review.moves.length, index)));
    setSaveStatus("idle");
  }

  function startRetry(move: ReviewMove) {
    setActiveSideline(null);
    setSelectedIndex(move.ply);
    setSaveStatus("idle");
    setRetry({
      targetPly: move.ply,
      status: "trying",
      attempts: 0,
      lastMoveUci: null,
      lastMoveSan: null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNextRetry() {
    if (!trainingMoves.length) return;
    const current = retry?.targetPly ?? selected?.ply ?? -1;
    const currentIndex = trainingMoves.findIndex((move) => move.ply === current);
    startRetry(trainingMoves[(currentIndex + 1 + trainingMoves.length) % trainingMoves.length]);
  }

  function submitRetry(uci: string) {
    if (!retryActive || !selected || retryDone) return;
    const chess = new Chess(selected.fen_before);
    let move;
    try {
      move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
    } catch {
      return;
    }
    const normalized = `${move.from}${move.to}${move.promotion ?? ""}`;
    const correct = normalized === bestMove;
    playMoveSound(Boolean(move.captured));
    setRetry((current) => current ? {
      ...current,
      status: correct ? "correct" : "wrong",
      attempts: current.attempts + 1,
      lastMoveUci: normalized,
      lastMoveSan: move.san,
    } : current);
  }

  async function persistSideline(sideline: ActiveSideline): Promise<ReviewSideline | null> {
    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/games/${game.id}/sidelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sideline.id,
          anchorPly: sideline.anchor_ply,
          movesUci: sideline.moves_uci,
          title: sideline.title,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "save_failed");
      const saved = data.sideline as ReviewSideline;
      setSavedSidelines((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setSaveStatus("saved");
      return saved;
    } catch {
      setSaveStatus("error");
      return null;
    }
  }

  async function deleteSideline(sideline: ReviewSideline) {
    if (!window.confirm(`Delete "${sideline.title}"?`)) return;
    try {
      const response = await fetch(`/api/games/${game.id}/sidelines`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sideline.id }),
      });
      if (!response.ok) throw new Error("delete_failed");
      setSavedSidelines((current) =>
        current.filter((item) => item.id !== sideline.id),
      );
      if (activeSideline?.id === sideline.id) goTo(sideline.anchor_ply);
    } catch {
      setSaveStatus("error");
    }
  }

  async function truncateSideline(sideline: ReviewSideline, keepCount: number) {
    if (keepCount <= 0) {
      await deleteSideline(sideline);
      return;
    }
    const removed = sideline.moves_san.slice(keepCount).join(" ");
    if (!window.confirm(`Remove ${removed} and everything after it from this sideline?`)) return;
    const truncated = hydrateSideline({
      ...sideline,
      moves_uci: sideline.moves_uci.slice(0, keepCount),
      moves_san: sideline.moves_san.slice(0, keepCount),
    });
    setActiveSideline(truncated);
    const saved = await persistSideline(truncated);
    if (saved) setActiveSideline(hydrateSideline(saved));
  }

  async function playMove(uci: string) {
    if (saveStatus === "saving") return;
    if (retryActive) {
      submitRetry(uci);
      return;
    }
    const chess = new Chess(boardFen);
    let move;
    try {
      move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || "q",
      });
    } catch {
      return;
    }
    const normalized = `${move.from}${move.to}${move.promotion ?? ""}`;
    const wasCapture = Boolean(move.captured);

    if (!activeSideline) {
      const anchorPly = selectedIndex;
      const nextMainline = review.moves[anchorPly]?.move_uci;
      if (normalized === nextMainline) {
        playMoveSound(wasCapture);
        goTo(anchorPly + 1);
        return;
      }
      const now = new Date().toISOString();
      const anchorLabel =
        anchorPly === 0
          ? "starting position"
          : moveLabel(review.moves[anchorPly - 1]);
      const draft: ActiveSideline = {
        id: null,
        anchor_ply: anchorPly,
        start_fen: boardFen,
        moves_uci: [normalized],
        moves_san: [move.san],
        title: `Sideline after ${anchorLabel}`,
        created_at: now,
        updated_at: now,
        fens: [boardFen, chess.fen()],
        cursor: 1,
      };
      setActiveSideline(draft);
      playMoveSound(wasCapture);
      const saved = await persistSideline(draft);
      if (saved) setActiveSideline(hydrateSideline(saved));
      return;
    }

    const isBranch = activeSideline.cursor < activeSideline.moves_uci.length;
    const movesUci = [
      ...activeSideline.moves_uci.slice(0, activeSideline.cursor),
      normalized,
    ];
    const movesSan = [
      ...activeSideline.moves_san.slice(0, activeSideline.cursor),
      move.san,
    ];
    const fens = [
      ...activeSideline.fens.slice(0, activeSideline.cursor + 1),
      chess.fen(),
    ];
    const updated: ActiveSideline = {
      ...activeSideline,
      id: isBranch ? null : activeSideline.id,
      title: isBranch ? `${activeSideline.title} · branch` : activeSideline.title,
      moves_uci: movesUci,
      moves_san: movesSan,
      fens,
      cursor: movesUci.length,
    };
    setActiveSideline(updated);
    playMoveSound(wasCapture);
    const saved = await persistSideline(updated);
    if (saved) setActiveSideline(hydrateSideline(saved));
  }

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/games/${game.id}/book`)
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as {
          available?: boolean;
          moves?: BookMoveInfo[];
        };
      })
      .then((data) => {
        if (cancelled || !data?.available || !data.moves) return;
        setBookMoves(
          Object.fromEntries(data.moves.map((move) => [move.ply, move])),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [game.id]);

  useEffect(() => {
    const container = notationRef.current;
    const current = container?.querySelector<HTMLElement>(
      '[data-current="true"]',
    );
    if (!container || !current) return;
    const containerRect = container.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    const above = currentRect.top < containerRect.top + 12;
    const below = currentRect.bottom > containerRect.bottom - 12;
    if (above || below) {
      container.scrollTo({
        top:
          container.scrollTop +
          currentRect.top -
          containerRect.top -
          container.clientHeight / 2 +
          currentRect.height / 2,
        behavior: "smooth",
      });
    }
  }, [activeSideline?.cursor, activeSideline?.id, selectedIndex]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (retryActive) {
        if (event.key === "Escape") {
          event.preventDefault();
          setRetry(null);
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (activeSideline) {
          const target = Math.max(0, activeSideline.cursor - 1);
          playMoveSound(target > 0 && activeSideline.moves_san[target - 1]?.includes("x"));
          setActiveSideline((line) =>
            line ? { ...line, cursor: Math.max(0, line.cursor - 1) } : line,
          );
        } else {
          const target = Math.max(0, selectedIndex - 1);
          playMoveSound(target > 0 && review.moves[target - 1]?.san.includes("x"));
          setSelectedIndex((index) => Math.max(0, index - 1));
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (activeSideline) {
          const target = Math.min(activeSideline.moves_uci.length, activeSideline.cursor + 1);
          playMoveSound(target > 0 && activeSideline.moves_san[target - 1]?.includes("x"));
          setActiveSideline((line) =>
            line
              ? {
                  ...line,
                  cursor: Math.min(line.moves_uci.length, line.cursor + 1),
                }
              : line,
          );
        } else {
          const target = Math.min(review.moves.length, selectedIndex + 1);
          playMoveSound(target > 0 && review.moves[target - 1]?.san.includes("x"));
          setSelectedIndex((index) =>
            Math.min(review.moves.length, index + 1),
          );
        }
      } else if (event.key === "Home") {
        event.preventDefault();
        if (activeSideline) {
          setActiveSideline((line) => (line ? { ...line, cursor: 0 } : line));
        } else {
          setSelectedIndex(0);
        }
      } else if (event.key === "End") {
        event.preventDefault();
        if (activeSideline) {
          setActiveSideline((line) =>
            line ? { ...line, cursor: line.moves_uci.length } : line,
          );
        } else {
          setSelectedIndex(review.moves.length);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSideline, playMoveSound, retryActive, review.moves, selectedIndex]);

  const navigationIndex = activeSideline?.cursor ?? selectedIndex;
  const navigationLength =
    activeSideline?.moves_uci.length ?? review.moves.length;
  const analysisAnchorPly = retryActive
    ? Math.max(0, selectedIndex - 1)
    : activeSideline?.anchor_ply ?? selectedIndex;
  const analysisLine = retryActive && retryDone && bestMove
    ? bestMove
    : activeSideline
      ? activeSideline.moves_uci.slice(0, activeSideline.cursor).join(",")
      : "";
  const analysisHref = `/analysis?game=${game.id}&ply=${analysisAnchorPly}${
    analysisLine ? `&line=${encodeURIComponent(analysisLine)}` : ""
  }`;

  function navigateTo(index: number) {
    if (activeSideline) {
      const target = Math.max(0, Math.min(activeSideline.moves_uci.length, index));
      if (target !== activeSideline.cursor) {
        playMoveSound(target > 0 && activeSideline.moves_san[target - 1]?.includes("x"));
      }
      setActiveSideline((line) =>
        line
          ? {
              ...line,
              cursor: target,
            }
          : line,
      );
    } else {
      const target = Math.max(0, Math.min(review.moves.length, index));
      if (target !== selectedIndex) {
        playMoveSound(target > 0 && review.moves[target - 1]?.san.includes("x"));
      }
      goTo(target);
    }
  }

  function renderSidelines(anchorPly: number) {
    return savedSidelines
      .filter((sideline) => sideline.anchor_ply === anchorPly)
      .map((sideline) => {
        const isActive = activeSideline?.id === sideline.id;
        const tokens = sidelineNotation(sideline);
        return (
          <div
            key={sideline.id}
            onContextMenu={(event) => {
              event.preventDefault();
              void deleteSideline(sideline);
            }}
            className={`col-span-3 ml-10 rounded-lg border-l-2 px-2 py-1.5 text-xs ${
              isActive
                ? "border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
                : "border-stone-300 bg-stone-50 text-stone-600 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300"
            }`}
            title="Click a move to open. Right-click a move to trim from there, or right-click the row to delete it."
          >
            <span className="mr-1 text-stone-400 dark:text-stone-500">(</span>
            {tokens.map((token, index) => (
                <button
                  key={`${sideline.id}-${index}`}
                  type="button"
                  onClick={() => {
                    setSelectedIndex(sideline.anchor_ply);
                    const hydrated = hydrateSideline(sideline);
                    setActiveSideline({ ...hydrated, cursor: index + 1 });
                    setSaveStatus("saved");
                    playMoveSound(sideline.moves_san[index]?.includes("x"));
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void truncateSideline(sideline, index);
                  }}
                  data-current={
                    isActive && activeSideline?.cursor === index + 1
                      ? "true"
                      : undefined
                  }
                  className={`mr-1 rounded px-1 py-0.5 font-mono ${
                    isActive && activeSideline?.cursor === index + 1
                      ? "bg-sky-700 text-white"
                      : "hover:bg-stone-200 dark:hover:bg-stone-700"
                  }`}
                >
                  {token}
                </button>
            ))}
            <span className="text-stone-400 dark:text-stone-500">)</span>
          </div>
        );
      });
  }

  return (
    <div className="space-y-8">
      <section className="grid items-start gap-5 xl:grid-cols-[minmax(540px,0.98fr)_minmax(430px,1.02fr)]">
        <div className="xl:sticky xl:top-20">
          <div className="mx-auto w-full max-w-[720px] xl:w-[calc(100vh-15.5rem)] xl:max-w-full">
            <PlayerStrip
              name={opponentName}
              rating={opponentRating}
              accuracy={opponentAccuracy}
              color={game.side === "white" ? "black" : "white"}
              captured={material[game.side === "white" ? "black" : "white"].captured}
              advantage={material[game.side === "white" ? "black" : "white"].advantage}
            />
            <div className="my-2 grid grid-cols-[34px_minmax(0,1fr)] items-stretch gap-2">
              {retryConcealed ? (
                <div className="grid place-items-center rounded-lg border border-stone-700 bg-stone-900 text-sm font-black text-stone-400" aria-label="Evaluation hidden during retry" title="Evaluation hidden during retry">?</div>
              ) : <EvaluationBar cp={evaluation} />}
              <div className="overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700">
                <Board
                  key={
                    activeSideline
                      ? `sideline-${activeSideline.id ?? "new"}-${activeSideline.cursor}`
                      : `main-${selectedIndex}`
                  }
                  fen={boardFen}
                  orientation={game.side}
                  disabled={saveStatus === "saving" || Boolean(retryDone)}
                  highlight={retryActive
                    ? squarePair(retryDone ? bestMove : retry?.lastMoveUci ?? null)
                    : activeSideline
                      ? squarePair(sidelineLastMove)
                      : squarePair(playedMove)}
                  highlightColor={retryActive && retry?.status === "wrong" ? "#ef4444" : retryDone ? "#22c55e" : undefined}
                  arrows={boardArrows}
                  badge={boardBadge}
                  allowDrawingArrows
                  onMove={(uci) => {
                    void playMove(uci);
                  }}
                />
              </div>
            </div>
            <PlayerStrip
              name={playerName}
              rating={playerRating}
              accuracy={playerAccuracy}
              color={game.side}
              captured={material[game.side].captured}
              advantage={material[game.side].advantage}
            />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-stone-500 dark:text-stone-400">
              <span className="flex items-center gap-1.5">
                <i
                  className={`h-0.5 w-5 ${
                    activeSideline ? "bg-sky-500" : "bg-lime-600"
                  }`}
                />
                {activeSideline
                  ? "Saved sideline"
                  : retryActive
                    ? retryDone
                      ? `Best move: ${bestSan ?? bestMove ?? "found"}`
                      : "Engine answer hidden"
                  : bestSan
                    ? `Engine best: ${bestSan}`
                    : "Recorded move"}
              </span>
              <span>
                {saveStatus === "saving"
                  ? "Saving…"
                  : retryActive
                    ? "Find a better move · Esc to exit"
                    : "Drag a piece to explore · right-drag for arrows"}
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !soundsEnabled;
                  setSoundsEnabled(next);
                  if (next) emitMoveSound(false);
                }}
                className="rounded-md px-1.5 py-0.5 transition hover:bg-stone-200 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                aria-pressed={soundsEnabled}
                title={soundsEnabled ? "Mute move sounds" : "Enable move sounds"}
              >
                {soundsEnabled ? "🔊 Sounds" : "🔇 Muted"}
              </button>
            </div>
          </div>
        </div>

        <aside className="flex min-h-[760px] flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900 xl:h-[calc(100vh-8.25rem)] xl:min-h-0">
          <div className="h-[190px] shrink-0 overflow-y-auto border-b border-stone-100 p-5 dark:border-stone-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  {activeSideline
                    ? "Saved sideline"
                    : retryActive
                      ? "Guided retry"
                    : latestOpening
                      ? latestOpening
                      : selected
                        ? `Position after ${moveLabel(selected)}`
                        : "Game overview"}
                </p>
                <h1 className="mt-1 truncate text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                  {activeSideline
                    ? activeSideline.title
                    : retryActive
                      ? `Find a better move for ${game.side === "white" ? "White" : "Black"}`
                    : selected
                      ? moveLabel(selected)
                      : `${playerName} vs ${opponentName}`}
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {retryActive ? (
                  <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${retryDone ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"}`}>
                    {retry?.status === "correct" ? "Solved" : retry?.status === "revealed" ? "Answer" : `${retry?.attempts ?? 0} ${retry?.attempts === 1 ? "try" : "tries"}`}
                  </span>
                ) : activeSideline ? (
                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${
                      saveStatus === "error"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {saveStatus === "saving"
                      ? "Saving…"
                      : saveStatus === "error"
                        ? "Save failed"
                        : "Saved"}
                  </span>
                ) : selected ? (
                  <span
                    className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold text-white"
                    style={{ background: meta.color }}
                  >
                    {meta.symbol} {meta.label}
                  </span>
                ) : null}
                <Link
                  href={analysisHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  prefetch={false}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800"
                  title="Open this exact position in the local Stockfish analysis board"
                >
                  Analysis ↗
                </Link>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
              {activeSideline
                ? "This variation is separate from the recorded game and autosaves after every legal move."
                : retryActive
                  ? retry?.status === "correct"
                    ? `Exactly. ${bestSan ?? bestMove} was the engine's best move. Compare what it changes before moving on.`
                    : retry?.status === "revealed"
                      ? `The best move was ${bestSan ?? bestMove}. Play through the engine arrow, then try the next position.`
                      : retry?.status === "wrong"
                        ? `${retry.lastMoveSan} is legal, but there is a stronger move. The board has reset—check forcing moves and loose pieces.`
                        : "The evaluation, comment, and best-move arrow are hidden. Make the move you would choose in a real game."
                : selected
                  ? moveComment(selected, {
                      isBook: selectedBook?.book,
                      openingName: selectedBook?.openingName,
                    })
                  : gameHeadline(review.moves, game.side)}
            </p>
            {retryActive ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!retryDone ? (
                  <button
                    type="button"
                    onClick={() => setRetry((current) => current ? { ...current, status: "revealed", lastMoveUci: bestMove, lastMoveSan: bestSan } : current)}
                    className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:border-violet-400 hover:text-violet-700 dark:border-stone-700 dark:text-stone-300"
                  >
                    Show answer
                  </button>
                ) : (
                  <button type="button" onClick={startNextRetry} className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-800">Next retry</button>
                )}
                <button type="button" onClick={() => setRetry(null)} className="px-2 py-1 text-xs font-semibold text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">Exit practice</button>
              </div>
            ) : selected && !activeSideline ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                <span>
                  Evaluation{" "}
                  <strong className="font-mono text-stone-900 dark:text-stone-100">
                    {formatEvaluation(evaluation)}
                  </strong>
                </span>
                {bestSan ? (
                  <span>
                    Best{" "}
                    <strong className="font-semibold text-lime-700">
                      {bestSan}
                    </strong>
                  </span>
                ) : null}
                {selectedBook?.book ? (
                  <span>{selectedBook.games.toLocaleString()} master games</span>
                ) : null}
                {selected.side === game.side && ["mistake", "blunder"].includes(selected.classification) && bestMove && bestMove !== selected.move_uci ? (
                  <button type="button" onClick={() => startRetry(selected)} className="font-bold text-violet-700 hover:underline dark:text-violet-400">↻ Retry this move</button>
                ) : null}
              </div>
            ) : activeSideline ? (
              <button
                type="button"
                onClick={() => goTo(activeSideline.anchor_ply)}
                className="mt-3 text-xs font-semibold text-sky-700 hover:underline"
              >
                Return to recorded game
              </button>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-50">
                  Move notation
                </h2>
                <p className="text-[11px] text-stone-400">
                  Multiple variations supported · right-click a move to trim
                </p>
              </div>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-300">
                {navigationIndex}/{navigationLength}
              </span>
            </div>
            <div
              ref={notationRef}
              className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            >
              <div className="grid grid-cols-[38px_1fr_1fr] gap-1 text-sm">
                {renderSidelines(0)}
                {Array.from(
                  { length: Math.ceil(review.moves.length / 2) },
                  (_, index) => {
                    const white = review.moves[index * 2];
                    const black = review.moves[index * 2 + 1];
                    return (
                      <div key={index} className="col-span-3 grid grid-cols-[38px_1fr_1fr] gap-1">
                        <span className="px-1 py-2 text-right font-mono text-xs text-stone-400 dark:text-stone-500">
                          {index + 1}.
                        </span>
                        {[white, black].map((move, sideIndex) => {
                          if (!move) return <span key={sideIndex} />;
                          const moveClass = bookMoves[move.ply]?.book
                            ? "book"
                            : move.classification;
                          const moveMeta =
                            classificationMeta[moveClass] ??
                            classificationMeta.unknown;
                          return (
                            <button
                              key={move.ply}
                              type="button"
                              data-current={
                                !activeSideline && selectedIndex === move.ply
                                  ? "true"
                                  : undefined
                              }
                              onClick={() => navigateTo(move.ply)}
                              className={`flex min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                                !activeSideline && selectedIndex === move.ply
                                  ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950"
                                  : "hover:bg-stone-100 dark:hover:bg-stone-800"
                              }`}
                            >
                              <span className="truncate font-medium">
                                {move.san}
                              </span>
                              {moveMeta.symbol ? (
                                <span
                                  className="text-xs font-bold"
                                  style={{
                                    color:
                                      !activeSideline &&
                                      selectedIndex === move.ply
                                        ? "#bef264"
                                        : moveMeta.color,
                                  }}
                                  title={moveMeta.label}
                                >
                                  {moveMeta.symbol}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                        {renderSidelines(white?.ply ?? -1)}
                        {black ? renderSidelines(black.ply) : null}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-stone-100 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-950/50">
            {retryActive ? (
              <div className="grid h-28 place-items-center rounded-2xl border border-dashed border-violet-300 bg-violet-50 text-center dark:border-violet-800 dark:bg-violet-950/30">
                <div><p className="text-sm font-bold text-violet-800 dark:text-violet-300">{retryDone ? `Best branch ${formatEvaluation(evaluation)}` : "Evaluation hidden"}</p><p className="mt-1 text-xs text-violet-600 dark:text-violet-400">{retryDone ? "Exit practice to compare it with the recorded-game graph." : "Commit to a move before seeing the swing."}</p></div>
              </div>
            ) : (
              <EvaluationGraph
                moves={review.moves}
                selectedPly={selectedIndex}
                onSelect={navigateTo}
                compact
                classifications={graphClassifications}
              />
            )}
          </div>

          <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-stone-100 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950/50">
            {[
              {
                label: "|←",
                title: "First position (Home)",
                action: () => navigateTo(0),
                disabled: navigationIndex === 0,
              },
              {
                label: "←",
                title: "Previous move (Left arrow)",
                action: () => navigateTo(navigationIndex - 1),
                disabled: navigationIndex === 0,
              },
              {
                label: "→",
                title: "Next move (Right arrow)",
                action: () => navigateTo(navigationIndex + 1),
                disabled: navigationIndex === navigationLength,
              },
              {
                label: "→|",
                title: "Last move (End)",
                action: () => navigateTo(navigationLength),
                disabled: navigationIndex === navigationLength,
              },
            ].map((control) => (
              <button
                key={control.title}
                type="button"
                title={control.title}
                aria-label={control.title}
                onClick={control.action}
                disabled={control.disabled}
                className="rounded-xl border border-stone-200 bg-white py-2.5 text-lg font-semibold text-stone-700 shadow-sm transition hover:border-emerald-400 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-35 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
              >
                {control.label}
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="rounded-3xl bg-stone-900 p-6 text-white shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-stone-400">
            <span>{game.time_class ?? "Chess"}</span>
            <span>•</span>
            <span>{game.played_at}</span>
            {latestOpening ? (
              <>
                <span>•</span>
                <span className="capitalize">{latestOpening}</span>
              </>
            ) : null}
          </div>
          <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div>
              <p className="truncate font-semibold">{playerName}</p>
              <p className="text-sm text-stone-400">{playerRating ?? "—"}</p>
            </div>
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-stone-500">
                Review score
              </p>
              <p className="mt-1 text-3xl font-black text-emerald-400">
                {playerAccuracy}
              </p>
            </div>
            <div className="text-right">
              <p className="truncate font-semibold">{opponentName}</p>
              <p className="text-sm text-stone-400">
                {opponentAccuracy} review score
              </p>
            </div>
          </div>
          <p className="mt-6 border-t border-stone-700 pt-4 text-sm leading-6 text-stone-300">
            {gameHeadline(review.moves, game.side)}
          </p>
        </div>

        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
            Your move quality
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              "brilliant",
              "great",
              "best",
              "book",
              "good",
              "inaccuracy",
              "mistake",
              "blunder",
            ].map((key) => {
              const item = classificationMeta[key];
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800"
                >
                  <span className="flex items-center gap-2 text-stone-600 dark:text-stone-300">
                    <i
                      className="h-2 w-2 rounded-full"
                      style={{ background: item.color }}
                    />
                    {item.label}
                  </span>
                  <strong className="text-stone-900 dark:text-stone-50">
                    {playerCounts[key] ?? 0}
                  </strong>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] leading-4 text-stone-400">
            Review scores and labels are transparent Stockfish-based estimates,
            not Chess.com&apos;s proprietary formula. Book labels use the
            authenticated Lichess Masters explorer.
          </p>
          {trainingMoves.length ? (
            <button type="button" onClick={() => startRetry(trainingMoves[0])} className="mt-4 flex w-full items-center justify-between rounded-xl bg-violet-600 px-4 py-3 text-left text-sm font-bold text-white transition hover:bg-violet-700">
              <span>Practice your turning points</span><span>{trainingMoves.length} positions →</span>
            </button>
          ) : null}
        </div>
      </section>

      {critical.length ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-700 dark:bg-stone-900">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Critical moments
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {critical.map((move) => (
              <button
                key={move.ply}
                type="button"
                onClick={() => {
                  navigateTo(move.ply);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:border-emerald-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              >
                {moveLabel(move)}{" "}
                {classificationMeta[move.classification]?.symbol}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
