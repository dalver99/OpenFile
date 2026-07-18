"use client";

import { useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow, PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { sideToMove } from "@/lib/chess";

type Props = {
  fen: string;
  orientation: "white" | "black";
  disabled?: boolean;
  highlight?: string[];
  highlightColor?: string;
  arrows?: Arrow[];
  badge?: {
    square: string;
    symbol: string;
    label: string;
    color: string;
  } | null;
  allowDrawingArrows?: boolean;
  onMove: (uci: string) => void;
};

type Selection = { square: string; pieceType: string };

// react-chessboard piece codes are "wP" / "bN" / etc: color prefix + FEN letter.
function pieceColor(pieceType: string): "white" | "black" {
  return pieceType.startsWith("w") ? "white" : "black";
}

function buildUci(sourceSquare: string, targetSquare: string, pieceType: string): string {
  const isPawn = pieceType[1] === "P";
  const targetRank = targetSquare[1];
  const promotes = isPawn && (targetRank === "8" || targetRank === "1");
  return sourceSquare + targetSquare + (promotes ? "q" : "");
}

export default function Board({
  fen,
  orientation,
  disabled,
  highlight = [],
  highlightColor = "#f59e0b",
  arrows = [],
  badge = null,
  allowDrawingArrows = false,
  onMove,
}: Props) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const mover = sideToMove(fen);

  function handleSquareClick({ piece, square }: SquareHandlerArgs) {
    if (disabled) return;
    const ownPiece = piece && pieceColor(piece.pieceType) === mover;

    if (selected === null) {
      if (ownPiece && piece) setSelected({ square, pieceType: piece.pieceType });
      return;
    }
    if (square === selected.square) {
      setSelected(null);
      return;
    }
    if (ownPiece && piece) {
      setSelected({ square, pieceType: piece.pieceType });
      return;
    }
    onMove(buildUci(selected.square, square, selected.pieceType));
    setSelected(null);
  }

  function handlePieceDrop({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (disabled || !targetSquare) return false;
    setSelected(null);
    onMove(buildUci(sourceSquare, targetSquare, piece.pieceType));
    return true;
  }

  const squareStyles: Record<string, React.CSSProperties> = {};
  for (const sq of highlight) {
    squareStyles[sq] = { outline: `3px solid ${highlightColor}`, outlineOffset: "-3px" };
  }
  if (selected) {
    squareStyles[selected.square] = {
      ...squareStyles[selected.square],
      outline: "3px solid #3b82f6",
      outlineOffset: "-3px",
    };
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-zinc-300 shadow-sm dark:border-zinc-700">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: !disabled,
          animationDurationInMs: 150,
          squareStyles,
          arrows,
          squareRenderer: ({ square, children }) => (
            <div className="relative h-full w-full">
              {children}
              {badge?.square === square ? (
                <span
                  aria-label={badge.label}
                  className="pointer-events-none absolute -right-[8%] -top-[12%] z-40 grid h-[38%] min-h-5 w-[38%] min-w-5 place-items-center rounded-full border-2 border-white/90 text-[clamp(10px,2.4vw,19px)] font-black leading-none text-white shadow-lg"
                  style={{ backgroundColor: badge.color }}
                  title={badge.label}
                >
                  {badge.symbol || "•"}
                </span>
              ) : null}
            </div>
          ),
          allowDrawingArrows,
          clearArrowsOnPositionChange: false,
          darkSquareStyle: { backgroundColor: "#7c9b5f" },
          lightSquareStyle: { backgroundColor: "#eaeed3" },
          canDragPiece: ({ piece }) => !disabled && pieceColor(piece.pieceType) === mover,
          onPieceDrop: handlePieceDrop,
          onSquareClick: handleSquareClick,
        }}
      />
    </div>
  );
}
