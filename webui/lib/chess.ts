// Minimal FEN helpers for rendering and click-to-move. No move legality here;
// the server verifies the submitted move against the stored solution.

const FILES = "abcdefgh";

const GLYPHS: Record<string, string> = {
  K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
  k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

// Returns 64 entries, index 0 = a8 ... index 63 = h1 (rank 8 first).
export function parseFen(fen: string): (string | null)[] {
  const placement = fen.split(" ")[0];
  const squares: (string | null)[] = [];
  for (const row of placement.split("/")) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) squares.push(null);
      } else {
        squares.push(ch);
      }
    }
  }
  return squares;
}

export function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

// index (0=a8..63=h1) -> algebraic square name, e.g. "e4".
export function squareName(index: number): string {
  const file = index % 8;
  const rank = 8 - Math.floor(index / 8);
  return FILES[file] + rank;
}

export function pieceGlyph(piece: string | null): string {
  return piece ? GLYPHS[piece] ?? "" : "";
}

export function isWhitePiece(piece: string): boolean {
  return piece === piece.toUpperCase();
}

// Build a UCI move from two square indices, defaulting promotions to queen.
export function toUci(fromIdx: number, toIdx: number, piece: string | null): string {
  const from = squareName(fromIdx);
  const to = squareName(toIdx);
  const toRank = 8 - Math.floor(toIdx / 8);
  const isPawn = piece?.toLowerCase() === "p";
  const promotes = isPawn && (toRank === 8 || toRank === 1);
  return from + to + (promotes ? "q" : "");
}

// SAN for the whole solution line, for display after solving.
export function lineToText(line: string[] | null | undefined): string {
  if (!line || line.length === 0) return "";
  return line.join(" ");
}
