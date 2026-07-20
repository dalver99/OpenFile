"use client";

import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, PieceHandlerArgs, PositionDataType, SquareHandlerArgs } from "react-chessboard";
import { useMemo, useState } from "react";

const PIECES = [
  ["wK", "♔", "White king"], ["wQ", "♕", "White queen"], ["wR", "♖", "White rook"],
  ["wB", "♗", "White bishop"], ["wN", "♘", "White knight"], ["wP", "♙", "White pawn"],
  ["bK", "♚", "Black king"], ["bQ", "♛", "Black queen"], ["bR", "♜", "Black rook"],
  ["bB", "♝", "Black bishop"], ["bN", "♞", "Black knight"], ["bP", "♟", "Black pawn"],
] as const;

const FEN_TO_PIECE: Record<string, string> = {
  K: "wK", Q: "wQ", R: "wR", B: "wB", N: "wN", P: "wP",
  k: "bK", q: "bQ", r: "bR", b: "bB", n: "bN", p: "bP",
};
const PIECE_TO_FEN = Object.fromEntries(Object.entries(FEN_TO_PIECE).map(([fen, piece]) => [piece, fen]));

function positionFromFen(fen: string): PositionDataType {
  const rows = fen.split(" ")[0].split("/");
  const position: PositionDataType = {};
  rows.forEach((row, rowIndex) => {
    let file = 0;
    for (const token of row) {
      if (/\d/.test(token)) {
        file += Number(token);
      } else {
        const square = `${String.fromCharCode(97 + file)}${8 - rowIndex}`;
        position[square] = { pieceType: FEN_TO_PIECE[token] };
        file += 1;
      }
    }
  });
  return position;
}

function boardFen(position: PositionDataType): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const square = `${String.fromCharCode(97 + file)}${rank}`;
      const piece = position[square]?.pieceType;
      if (!piece) {
        empty += 1;
      } else {
        if (empty) row += String(empty);
        empty = 0;
        row += PIECE_TO_FEN[piece] ?? "";
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join("/");
}

export default function PositionEditor({
  initialFen,
  orientation,
  onCancel,
  onApply,
}: {
  initialFen: string;
  orientation: "white" | "black";
  onCancel: () => void;
  onApply: (fen: string) => void;
}) {
  const fields = initialFen.split(" ");
  const initialPosition = useMemo(() => positionFromFen(initialFen), [initialFen]);
  const [position, setPosition] = useState<PositionDataType>(initialPosition);
  const [selectedPiece, setSelectedPiece] = useState<string | "erase">("wP");
  const [turn, setTurn] = useState<"w" | "b">(fields[1] === "b" ? "b" : "w");
  const [castling, setCastling] = useState(() => new Set((fields[2] === "-" ? "" : fields[2]).split("")));
  const [enPassant, setEnPassant] = useState(fields[3] ?? "-");
  const [error, setError] = useState<string | null>(null);

  function place({ square }: SquareHandlerArgs) {
    setPosition((current) => {
      const next = { ...current };
      if (selectedPiece === "erase") delete next[square];
      else next[square] = { pieceType: selectedPiece };
      return next;
    });
  }

  function replacePiece({ square }: PieceHandlerArgs) {
    if (square) place({ square, piece: position[square] ?? null });
  }

  function drop({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    setPosition((current) => {
      const next = { ...current };
      delete next[sourceSquare];
      if (targetSquare) next[targetSquare] = { pieceType: piece.pieceType };
      return next;
    });
    return true;
  }

  function toggleCastling(value: string) {
    setCastling((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function apply() {
    const whiteKings = Object.values(position).filter((piece) => piece.pieceType === "wK").length;
    const blackKings = Object.values(position).filter((piece) => piece.pieceType === "bK").length;
    if (whiteKings !== 1 || blackKings !== 1) {
      setError("A position needs exactly one white king and one black king.");
      return;
    }
    if (Object.entries(position).some(([square, piece]) => piece.pieceType.endsWith("P") && ["1", "8"].includes(square[1]))) {
      setError("Pawns cannot be placed on the first or eighth rank.");
      return;
    }
    const rights = ["K", "Q", "k", "q"].filter((right) => castling.has(right)).join("") || "-";
    const ep = enPassant.trim() || "-";
    if (ep !== "-" && !/^[a-h][36]$/.test(ep)) {
      setError("En passant must be “-” or a square such as e3 or e6.");
      return;
    }
    const fen = `${boardFen(position)} ${turn} ${rights} ${ep} 0 1`;
    try {
      new Chess(fen);
    } catch {
      setError("This arrangement is not a legal analyzable chess position.");
      return;
    }
    onApply(fen);
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-stone-950/75 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="Board editor">
      <div className="mx-auto grid max-w-5xl gap-5 rounded-2xl border border-stone-700 bg-[#f7f6f2] p-4 shadow-2xl dark:bg-stone-950 md:grid-cols-[minmax(320px,1fr)_19rem] sm:p-5">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-400">Position editor</p><h2 className="text-xl font-black text-stone-900 dark:text-white">Build any position</h2></div>
            <button type="button" onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-lg border border-stone-300 text-stone-500 hover:text-stone-900 dark:border-stone-700 dark:hover:text-white" aria-label="Close board editor">×</button>
          </div>
          <div className="mx-auto max-w-[620px] overflow-hidden border border-stone-300 dark:border-stone-700">
            <Chessboard options={{
              id: "openfile-position-editor",
              position,
              boardOrientation: orientation,
              allowDragging: true,
              allowDragOffBoard: true,
              animationDurationInMs: 0,
              canDragPiece: () => true,
              onPieceDrop: drop,
              onPieceClick: replacePiece,
              onSquareClick: place,
              darkSquareStyle: { backgroundColor: "#7c9b5f" },
              lightSquareStyle: { backgroundColor: "#eaeed3" },
            }} />
          </div>
          <p className="mt-2 text-center text-xs text-stone-500">Choose a piece, then click squares. Drag existing pieces or drag them off the board to remove them.</p>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Pieces</p>
            <p className="mt-1 text-xs font-semibold text-stone-600 dark:text-stone-300">Selected: {selectedPiece === "erase" ? "Eraser" : PIECES.find(([piece]) => piece === selectedPiece)?.[2]}</p>
            <div className="mt-2 grid grid-cols-6 gap-1.5 md:grid-cols-3">
              {PIECES.map(([piece, symbol, label]) => <button key={piece} type="button" onClick={() => setSelectedPiece(piece)} aria-label={label} aria-pressed={selectedPiece === piece} className={`grid aspect-square place-items-center rounded-lg border text-3xl leading-none ${piece.startsWith("b") ? "bg-stone-100 text-stone-950" : "bg-stone-700 text-white"} ${selectedPiece === piece ? "border-brand-600 ring-2 ring-brand-300" : "border-stone-300"}`}>{symbol}</button>)}
            </div>
            <button type="button" onClick={() => setSelectedPiece("erase")} aria-pressed={selectedPiece === "erase"} className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-bold ${selectedPiece === "erase" ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/40" : "border-stone-200 text-stone-500 dark:border-stone-700"}`}>⌫ Eraser</button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPosition({})} className="rounded-lg border border-stone-200 px-2 py-2 text-xs font-bold text-stone-500 hover:border-rose-300 dark:border-stone-700">Clear</button>
              <button type="button" onClick={() => setPosition(positionFromFen(new Chess().fen()))} className="rounded-lg border border-stone-200 px-2 py-2 text-xs font-bold text-stone-500 hover:border-brand-400 dark:border-stone-700">Starting</button>
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Side to move</p>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
              {([["w", "White"], ["b", "Black"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTurn(value)} className={`rounded-md px-2 py-2 text-xs font-black ${turn === value ? "bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white" : "text-stone-500"}`}>{label}</button>)}
            </div>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-stone-400">Castling rights</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-600 dark:text-stone-300">
              {[["K", "White O-O"], ["Q", "White O-O-O"], ["k", "Black O-O"], ["q", "Black O-O-O"]].map(([value, label]) => <label key={value} className="flex items-center gap-1.5"><input type="checkbox" checked={castling.has(value)} onChange={() => toggleCastling(value)} className="accent-brand-700" />{label}</label>)}
            </div>
            <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-stone-400">En passant square
              <input value={enPassant} onChange={(event) => setEnPassant(event.target.value)} maxLength={2} placeholder="-" className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs normal-case text-stone-700 outline-none focus:border-brand-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200" />
            </label>
          </section>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
          <button type="button" onClick={apply} className="w-full rounded-lg bg-brand-700 px-4 py-3 text-sm font-black text-white shadow-lg hover:bg-brand-800">Use this position →</button>
        </aside>
      </div>
    </div>
  );
}
