export type InsightSlice = {
  label: string;
  games: number;
  moves: number;
  accuracy: number;
  averageLoss: number;
  severeErrors: number;
  blunders: number;
};

export type OpeningInsight = InsightSlice & {
  winRate: number;
};

export type TrendGame = {
  id: number;
  playedAt: string | null;
  opponentLabel: string;
  accuracy: number;
  result: "win" | "draw" | "loss";
};

export type ClockInsight = {
  archiveGames: number;
  archiveGamesWithClock: number;
  reviewedGamesWithClock: number;
  trackedMoves: number;
  timePressureMoves: number;
  severeErrors: number;
  timePressureSevereErrors: number;
  averageLossUnderPressure: number | null;
  averageLossWithTime: number | null;
};

export type BrilliantInsight = {
  gameId: number;
  playedAt: string | null;
  moveNumber: number;
  side: "white" | "black";
  san: string;
  opening: string;
};

export type PlayerInsights = {
  reviewedGames: number;
  totalMoves: number;
  averageAccuracy: number;
  severeErrors: number;
  blunders: number;
  brilliantMoves: number;
  brilliancies: BrilliantInsight[];
  phase: InsightSlice[];
  timeClasses: InsightSlice[];
  openings: OpeningInsight[];
  trend: TrendGame[];
  clock: ClockInsight;
  focus: {
    title: string;
    detail: string;
    href: string | null;
  };
};
