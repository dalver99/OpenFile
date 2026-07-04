"""Puzzle quality gate and difficulty estimation.

A position becomes a good "find the move you missed" puzzle only when:

1. The player actually threw away significant value (``cp_loss`` is high).
2. There is a *clearly best* move — a decisive gap between the best line and
   the second best — so the puzzle has a single defensible answer.
3. The solution reaches a position that is not already hopeless, so solving it
   is instructive rather than "least-bad move in a lost game".

The gap requirement (2) is the main quality lever: the previous generator used
a 15cp gap, which admits almost any position. We default much higher.
"""

from __future__ import annotations

from dataclasses import dataclass

from analysis_cron.puzzles.scoring import Line


@dataclass(frozen=True)
class QualityConfig:
    min_cp_loss: int = 150
    min_top_gap_cp: int = 120
    # The best available move must reach at least this eval (mover POV);
    # otherwise the position is too lost to be instructive.
    solution_eval_floor_cp: int = -150
    # If > 0, reject positions already winning by more than this (nothing to
    # "find"). 0 disables the cap.
    solution_eval_ceiling_cp: int = 0


@dataclass(frozen=True)
class QualityResult:
    is_quality: bool
    quality_score: int  # 0..100, higher is better
    difficulty: int  # 1 (easy) .. 5 (hard)
    reject_reason: str | None = None


def _gap_cp(lines: list[Line]) -> int:
    """Decisiveness of the best move over the second best (mover POV)."""
    best, second = lines[0], lines[1]
    # A mate that the runner-up does not share is effectively decisive.
    if best.score.is_mate and not second.score.is_mate:
        return 100_000
    return best.score.cp - second.score.cp


def evaluate_quality(
    lines: list[Line],
    cp_loss: int,
    *,
    themes: list[str],
    solution_is_forcing: bool,
    solution_is_quiet: bool,
    solution_is_recapture: bool,
    mate_in: int | None,
    config: QualityConfig,
) -> QualityResult:
    if len(lines) < 2:
        return QualityResult(False, 0, 1, "needs_at_least_two_lines")

    best = lines[0]

    if cp_loss < config.min_cp_loss:
        return QualityResult(False, 0, 1, "cp_loss_below_min")

    gap = _gap_cp(lines)
    if gap < config.min_top_gap_cp:
        return QualityResult(False, 0, 1, "best_move_not_decisive")

    if not best.score.is_mate and best.score.cp < config.solution_eval_floor_cp:
        return QualityResult(False, 0, 1, "solution_still_lost")

    if (
        config.solution_eval_ceiling_cp > 0
        and not best.score.is_mate
        and best.score.cp > config.solution_eval_ceiling_cp
    ):
        return QualityResult(False, 0, 1, "position_already_won")

    # --- quality score (0..100) ---
    score = 0
    # Decisiveness (capped): a clearer best move is a cleaner puzzle.
    score += min(40, gap // 20)
    # Severity of the miss.
    score += min(25, cp_loss // 20)
    # Motif bonuses.
    theme_bonus = {
        "mate": 25,
        "fork": 18,
        "sacrifice": 20,
        "discovered_check": 15,
        "promotion": 10,
        "wins_material": 12,
        "defensive": 8,
    }
    score += max((theme_bonus.get(t, 0) for t in themes), default=0)
    if solution_is_forcing:
        score += 5
    quality_score = max(0, min(100, score))

    # --- difficulty (1..5) ---
    difficulty = 2
    if solution_is_quiet:
        difficulty += 1  # quiet best moves are harder to spot
    if solution_is_recapture:
        difficulty -= 1  # obvious recaptures are easy
    if mate_in is not None and abs(mate_in) >= 4:
        difficulty += 1  # long forced mates
    if gap >= 400:
        difficulty -= 1  # a crushing, obvious refutation
    if cp_loss < 250:
        difficulty += 1  # subtle mistakes are harder to punish
    difficulty = max(1, min(5, difficulty))

    return QualityResult(True, quality_score, difficulty, None)
