import "server-only";

import type {
  InsightSlice,
  OpeningInsight,
  PlayerInsights,
} from "@/domain/insights";
import { WEBUI_USER_ID } from "@/server/current-user";
import { pool } from "@/server/database/postgres";

type PhaseName = "Opening" | "Middlegame" | "Endgame";

type InsightRow = {
  player_game_id: number;
  played_at: string | null;
  time_class: string | null;
  time_control: string | null;
  player_side: "white" | "black";
  result: string;
  opening: string | null;
  pgn: string;
  moves: Array<{
    ply: number;
    move_number: number;
    classification: string;
    centipawn_loss: number | null;
  }>;
};

type GameAccumulator = {
  id: number;
  playedAt: string | null;
  timeClass: string;
  timeControl: string | null;
  side: "white" | "black";
  result: string;
  opening: string;
  pgn: string;
  moves: Array<{
    ply: number;
    moveNumber: number;
    classification: string;
    loss: number;
  }>;
};

const DRAW_RESULTS = new Set([
  "agreed",
  "stalemate",
  "repetition",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

function resultKind(result: string): "win" | "draw" | "loss" {
  if (result === "win") return "win";
  return DRAW_RESULTS.has(result) ? "draw" : "loss";
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundedAverage(values: number[]): number {
  return Math.round(average(values));
}

function accuracyFromLosses(losses: number[]): number {
  if (!losses.length) return 100;
  const capped = losses.map((loss) => Math.min(Math.max(loss, 0), 1_000));
  return Math.max(1, Math.round(100 * Math.exp(-average(capped) / 250)));
}

function isSevere(classification: string): boolean {
  return classification === "mistake" || classification === "blunder";
}

function phaseFor(moveNumber: number): PhaseName {
  if (moveNumber <= 10) return "Opening";
  if (moveNumber <= 30) return "Middlegame";
  return "Endgame";
}

function cleanOpening(value: string | null): string {
  if (!value) return "Unknown opening";
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clockSeconds(pgn: string): number[] {
  const values: number[] = [];
  const pattern = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g;
  for (const match of pgn.matchAll(pattern)) {
    values.push(Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]));
  }
  return values;
}

function baseAndIncrement(timeControl: string | null): { base: number; increment: number } | null {
  const match = timeControl?.match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return null;
  return { base: Number(match[1]), increment: Number(match[2] ?? 0) };
}

function makeSlice(label: string, games: GameAccumulator[], moves: GameAccumulator["moves"]): InsightSlice {
  const losses = moves.map((move) => move.loss);
  return {
    label,
    games: games.length,
    moves: moves.length,
    accuracy: accuracyFromLosses(losses),
    averageLoss: roundedAverage(losses),
    severeErrors: moves.filter((move) => isSevere(move.classification)).length,
    blunders: moves.filter((move) => move.classification === "blunder").length,
  };
}

export async function getPlayerInsights(): Promise<PlayerInsights> {
  const [moveResult, archiveResult] = await Promise.all([
    pool.query<InsightRow>(
      `SELECT pg.id::int AS player_game_id,
              to_char(g.end_time, 'YYYY-MM-DD') AS played_at, g.time_class, g.time_control,
              pg.side AS player_side, pg.result,
              CASE WHEN g.eco_url IS NULL THEN NULL
                   ELSE replace(regexp_replace(g.eco_url, '^.*/', ''), '-', ' ')
              END AS opening,
              g.pgn,
              jsonb_agg(
                jsonb_build_object(
                  'ply', ma.ply,
                  'move_number', ma.move_number,
                  'classification', ma.classification,
                  'centipawn_loss', ma.centipawn_loss
                ) ORDER BY ma.ply
              ) AS moves
       FROM game_analyses ga
       JOIN player_games pg ON pg.id = ga.player_game_id AND pg.player_id = ga.player_id
       JOIN chesscom_games g ON g.id = pg.game_id
       JOIN move_analyses ma ON ma.game_analysis_id = ga.id AND ma.side = pg.side
       WHERE ga.player_id = $1 AND pg.player_id = $1 AND g.rules = 'chess'
       GROUP BY ga.id, pg.id, g.id
       ORDER BY g.end_time DESC NULLS LAST, pg.id DESC`,
      [WEBUI_USER_ID],
    ),
    pool.query<{ archive_games: number; archive_games_with_clock: number }>(
      `SELECT count(*)::int AS archive_games,
              count(*) FILTER (WHERE g.pgn LIKE '%[%clk %')::int AS archive_games_with_clock
       FROM chesscom_games g
       JOIN player_games pg ON pg.game_id = g.id
       WHERE pg.player_id = $1 AND g.rules = 'chess'`,
      [WEBUI_USER_ID],
    ),
  ]);

  const games: GameAccumulator[] = moveResult.rows.map((row) => ({
      id: Number(row.player_game_id),
      playedAt: row.played_at,
      timeClass: row.time_class ?? "unknown",
      timeControl: row.time_control,
      side: row.player_side,
      result: row.result,
      opening: cleanOpening(row.opening),
      pgn: row.pgn,
      moves: row.moves.map((move) => ({
        ply: Number(move.ply),
        moveNumber: Number(move.move_number),
        classification: move.classification,
        // Mate scores and forced-mate transitions use sentinel-sized values.
        // Cap them to one severe error so they do not swamp human-scale CPL.
        loss: Math.min(1_000, Math.max(0, Number(move.centipawn_loss ?? 0))),
      })),
    }));
  const allMoves = games.flatMap((game) => game.moves);
  const gameAccuracies = games.map((game) => accuracyFromLosses(game.moves.map((move) => move.loss)));

  const phase = (["Opening", "Middlegame", "Endgame"] as PhaseName[]).map((label) => {
    const matchingMoves = allMoves.filter((move) => phaseFor(move.moveNumber) === label);
    const matchingGames = games.filter((game) => game.moves.some((move) => phaseFor(move.moveNumber) === label));
    return makeSlice(label, matchingGames, matchingMoves);
  });

  const timeClassNames = [...new Set(games.map((game) => game.timeClass))];
  const preferredOrder = ["rapid", "blitz", "bullet", "daily", "unknown"];
  timeClassNames.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex) || a.localeCompare(b);
  });
  const timeClasses = timeClassNames.map((label) => {
    const matchingGames = games.filter((game) => game.timeClass === label);
    return makeSlice(label[0]?.toUpperCase() + label.slice(1), matchingGames, matchingGames.flatMap((game) => game.moves));
  });

  const openingNames = [...new Set(games.map((game) => game.opening))];
  const openings = openingNames
    .map((label): OpeningInsight => {
      const matchingGames = games.filter((game) => game.opening === label);
      const slice = makeSlice(label, matchingGames, matchingGames.flatMap((game) => game.moves));
      const points = matchingGames.reduce((sum, game) => {
        const result = resultKind(game.result);
        return sum + (result === "win" ? 1 : result === "draw" ? 0.5 : 0);
      }, 0);
      return { ...slice, winRate: matchingGames.length ? Math.round((points / matchingGames.length) * 100) : 0 };
    })
    .sort((a, b) => b.games - a.games || b.averageLoss - a.averageLoss)
    .slice(0, 8);

  const pressureLosses: number[] = [];
  const normalLosses: number[] = [];
  let reviewedGamesWithClock = 0;
  let timePressureMoves = 0;
  let timePressureSevereErrors = 0;
  let clockSevereErrors = 0;
  let trackedMoves = 0;

  for (const game of games) {
    const clocks = clockSeconds(game.pgn);
    const control = baseAndIncrement(game.timeControl);
    if (!control || clocks.length < Math.max(...game.moves.map((move) => move.ply), 0)) continue;
    reviewedGamesWithClock += 1;
    const pressureThreshold = control.base * 0.1;
    for (const move of game.moves) {
      const previousClock = move.ply > 2 ? clocks[move.ply - 3] : control.base;
      if (!Number.isFinite(previousClock)) continue;
      trackedMoves += 1;
      const underPressure = previousClock <= pressureThreshold;
      const severe = isSevere(move.classification);
      if (severe) clockSevereErrors += 1;
      if (underPressure) {
        timePressureMoves += 1;
        pressureLosses.push(move.loss);
        if (severe) timePressureSevereErrors += 1;
      } else {
        normalLosses.push(move.loss);
      }
    }
  }

  const trend = games
    .slice(0, 12)
    .reverse()
    .map((game) => ({
      id: game.id,
      playedAt: game.playedAt,
      opponentLabel: game.opening,
      accuracy: accuracyFromLosses(game.moves.map((move) => move.loss)),
      result: resultKind(game.result),
    }));

  const phaseCandidates = phase.filter((slice) => slice.moves >= 5);
  const weakestPhase = [...phaseCandidates].sort((a, b) => b.averageLoss - a.averageLoss)[0];
  const openingCandidate = openings
    .filter((opening) => opening.games >= 2 && opening.label !== "Unknown opening")
    .sort((a, b) => b.averageLoss - a.averageLoss)[0];
  const focusGame = games.find((game) => game.moves.some((move) => phaseFor(move.moveNumber) === weakestPhase?.label));
  const focus = weakestPhase
    ? {
        title: `${weakestPhase.label} decisions are the clearest training target`,
        detail: openingCandidate
          ? `Your ${weakestPhase.label.toLowerCase()} moves average ${weakestPhase.averageLoss} centipawns of loss. The ${openingCandidate.label} is the most useful repeated opening to revisit (${openingCandidate.games} games).`
          : `Your ${weakestPhase.label.toLowerCase()} moves average ${weakestPhase.averageLoss} centipawns of loss across ${weakestPhase.moves} decisions. Review the largest swings there before adding new theory.`,
        href: focusGame ? `/games/${focusGame.id}` : null,
      }
    : {
        title: "Analyze a few more games to reveal a pattern",
        detail: "Insights become useful once each phase has at least five of your moves.",
        href: "/games",
      };

  const archive = archiveResult.rows[0] ?? { archive_games: 0, archive_games_with_clock: 0 };
  return {
    reviewedGames: games.length,
    totalMoves: allMoves.length,
    averageAccuracy: roundedAverage(gameAccuracies),
    severeErrors: allMoves.filter((move) => isSevere(move.classification)).length,
    blunders: allMoves.filter((move) => move.classification === "blunder").length,
    phase,
    timeClasses,
    openings,
    trend,
    clock: {
      archiveGames: Number(archive.archive_games),
      archiveGamesWithClock: Number(archive.archive_games_with_clock),
      reviewedGamesWithClock,
      trackedMoves,
      timePressureMoves,
      severeErrors: clockSevereErrors,
      timePressureSevereErrors,
      averageLossUnderPressure: pressureLosses.length ? roundedAverage(pressureLosses) : null,
      averageLossWithTime: normalLosses.length ? roundedAverage(normalLosses) : null,
    },
    focus,
  };
}
