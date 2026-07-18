/** Public puzzle data. Solution fields stay on the server. */
export type PuzzleCard = {
  id: number;
  fen_before: string;
  last_move_uci: string | null;
  side_to_move: "white" | "black";
  phase: string | null;
  tag: string | null;
  themes: string[];
  cp_loss: number | null;
  is_mate: boolean;
  mate_in: number | null;
  difficulty: number | null;
  quality_score: number | null;
  time_class: string | null;
  opponent_username: string | null;
  played_at: string | null;
  progress_status: "sent" | "solved" | "revealed" | null;
  attempts: number;
};
