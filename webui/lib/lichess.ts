/** Build a shareable Lichess analysis-board URL for one exact position. */
export function lichessAnalysisUrl(
  fen: string,
  orientation: "white" | "black" = "white",
): string {
  const fields = fen.trim().split(/\s+/);
  const encodedFen = fields
    .map((field, index) => index === 0
      ? field.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(field))
    .join("_");
  return `https://lichess.org/analysis/standard/${encodedFen}?color=${orientation}`;
}
