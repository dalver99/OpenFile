/** Data shared between the game repositories and browser features. */
export type GameCard = {
  id: number;
  white_username: string;
  black_username: string;
  white_rating: number | null;
  black_rating: number | null;
  white_result: string | null;
  black_result: string | null;
  played_at: string | null;
  time_class: string | null;
  time_control: string | null;
  side: "white" | "black";
  result: string;
  rating_after: number | null;
  status: string;
  status_detail: string | null;
  opening: string | null;
  analyzed: boolean;
  analysis_depth: number | null;
  is_favorite: boolean;
};

export type GameListFilters = {
  query: string;
  timeClass: "rapid" | "blitz" | "bullet" | "all";
  review: "all" | "reviewed" | "waiting";
  favorite: "all" | "favorites";
  syncRunId: number | null;
};

export type GamePage = {
  games: GameCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type GameArchiveStats = {
  total: number;
  reviewed: number;
  waiting: number;
  analyzing: number;
};

export type CandidateLine = {
  move?: string | null;
  best_move?: string | null;
  score_cp?: number | null;
  pv?: string[];
};

export type ReviewMove = {
  ply: number;
  move_number: number;
  side: "white" | "black";
  move_uci: string;
  san: string;
  classification: string;
  centipawn_loss: number | null;
  evaluation_before_cp: number | null;
  evaluation_after_cp: number | null;
  evaluation_change_cp: number | null;
  played_rank: number | null;
  top_moves: CandidateLine[];
  fen_before: string;
  fen_after: string;
  clock_seconds: number | null;
};

export type ReviewSideline = {
  id: number;
  anchor_ply: number;
  start_fen: string;
  moves_uci: string[];
  moves_san: string[];
  title: string;
  created_at: string;
  updated_at: string;
};

export type GameReview = {
  game: GameCard & {
    chesscom_url: string;
    engine_id: string | null;
    analysis_created_at: string | null;
  };
  moves: ReviewMove[];
  sidelines: ReviewSideline[];
};
