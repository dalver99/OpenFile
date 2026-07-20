"use client";

import { useRef, useState } from "react";
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

const annotationColors = {
  default: "rgba(239, 68, 68, 0.55)",
  shift: "rgba(34, 197, 94, 0.52)",
  control: "rgba(245, 158, 11, 0.58)",
  alt: "rgba(59, 130, 246, 0.52)",
} as const;

function annotationColor(event: React.MouseEvent): string {
  if (event.altKey) return annotationColors.alt;
  if (event.shiftKey) return annotationColors.shift;
  if (event.ctrlKey || event.metaKey) return annotationColors.control;
  return annotationColors.default;
}

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
  allowDrawingArrows = true,
  onMove,
}: Props) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [coloredSquares, setColoredSquares] = useState<Record<string, string>>({});
  const rightDownSquare = useRef<string | null>(null);
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

  function handleSquareMouseDown(
    { square }: SquareHandlerArgs,
    event: React.MouseEvent,
  ) {
    if (event.button === 0) {
      setColoredSquares({});
      rightDownSquare.current = null;
    } else if (event.button === 2) {
      rightDownSquare.current = square;
    }
  }

  function handleSquareMouseUp(
    { square }: SquareHandlerArgs,
    event: React.MouseEvent,
  ) {
    const start = rightDownSquare.current;
    rightDownSquare.current = null;
    if (event.button !== 2 || start !== square) return;
    const color = annotationColor(event);
    setColoredSquares((current) => {
      if (current[square] === color) {
        const next = { ...current };
        delete next[square];
        return next;
      }
      return { ...current, [square]: color };
    });
  }

  const squareStyles: Record<string, React.CSSProperties> = {};
  for (const [square, color] of Object.entries(coloredSquares)) {
    squareStyles[square] = { backgroundColor: color };
  }
  for (const sq of highlight) {
    squareStyles[sq] = {
      ...squareStyles[sq],
      outline: `3px solid ${highlightColor}`,
      outlineOffset: "-3px",
    };
  }
  if (selected) {
    squareStyles[selected.square] = {
      ...squareStyles[selected.square],
      outline: "3px solid #3b82f6",
      outlineOffset: "-3px",
    };
  }

  return (
    <div className="w-full overflow-hidden border border-zinc-300 shadow-sm dark:border-zinc-700">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: !disabled,
          animationDurationInMs: 150,
          squareStyles,
          arrows,
          squareRenderer: ({ square, children }) => (
            <div
              className="relative h-full w-full"
              data-user-annotation={coloredSquares[square] ? "square" : undefined}
              style={squareStyles[square]}
            >
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
          clearArrowsOnClick: true,
          darkSquareStyle: { backgroundColor: "#7c9b5f" },
          lightSquareStyle: { backgroundColor: "#eaeed3" },
          canDragPiece: ({ piece }) => !disabled && pieceColor(piece.pieceType) === mover,
          onPieceDrop: handlePieceDrop,
          onSquareClick: handleSquareClick,
          onSquareMouseDown: handleSquareMouseDown,
          onSquareMouseUp: handleSquareMouseUp,
        }}
      />
    </div>
  );
}
