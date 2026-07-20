"""Command-line entry point: one subcommand per pipeline stage.

    openfile setup          # configure local SQLite + Stockfish
    openfile doctor         # diagnose this computer
    openfile ingest         # sync Chess.com games
    openfile analyze        # analyze one selected game
    openfile generate       # cook one analyzed game into a puzzle
    openfile run            # ingest -> select -> analyze -> generate (once)
"""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from pathlib import Path

from chesspipe.config import Settings


def _print(result: dict) -> None:
    print(json.dumps(result, indent=2, sort_keys=True, default=str))


def _print_next_steps(result: dict) -> None:
    steps = result.get("next_steps", [])
    if not steps:
        return
    print("\nNext steps:")
    for index, step in enumerate(steps, start=1):
        print(f"  {index}. {step}")


def _cmd_ingest(args: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.stages import ingest_stage

    result = ingest_stage(
        settings,
        force=args.force,
        archive_months=args.months,
        max_sync_games=args.max_games,
        sync_run_id=args.sync_run_id,
    )
    _print(result)
    return 0 if result.get("status") in ("ok", "idle") else 1


def _cmd_import_game(args: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.stages import import_game_stage

    result = import_game_stage(settings, args.url)
    _print(result)
    return 0 if result.get("status") == "ok" else 1


def _cmd_select(args: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.stages import select_stage

    _print(select_stage(settings, limit=args.limit))
    return 0


def _cmd_analyze(args: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.stages import analyze_game_stage, analyze_stage

    result = (
        analyze_game_stage(settings, args.player_game_id, force=args.force)
        if args.player_game_id is not None
        else analyze_stage(settings)
    )
    _print(result)
    return 1 if result.get("status") == "failed" else 0


def _cmd_generate(args: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.stages import generate_stage

    result = generate_stage(
        settings,
        retry_no_puzzle=args.retry_no_puzzle,
    )
    _print(result)
    return 1 if result.get("status") == "failed" else 0


def _cmd_run(_: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.stages import run_pipeline

    result = run_pipeline(settings)
    _print(result)
    failed = any(step.get("status") == "failed" for step in result.get("steps", []))
    return 1 if failed else 0


def _cmd_setup(args: argparse.Namespace, _settings: Settings | None = None) -> int:
    from chesspipe.setup import configure

    try:
        result = configure(
            chesscom_username=args.chesscom,
            stockfish_path=args.stockfish,
            lichess_api_key=args.lichess_key,
            language=args.lang,
            assume_yes=args.yes,
        )
    except RuntimeError as exc:
        _print({"status": "error", "detail": str(exc)})
        return 1
    _print(result)
    _print_next_steps(result)
    return 0


def _cmd_doctor(_: argparse.Namespace, _settings: Settings | None = None) -> int:
    from chesspipe.setup import doctor

    result = doctor()
    _print(result)
    _print_next_steps(result)
    return 0 if result["status"] == "ok" else 1


def _cmd_config(args: argparse.Namespace, _settings: Settings | None = None) -> int:
    from chesspipe.setup import manage_config

    try:
        _print(manage_config(args.config_action, args.key, args.value))
    except RuntimeError as exc:
        _print({"status": "error", "detail": str(exc)})
        return 1
    return 0


def _cmd_automation(args: argparse.Namespace, _settings: Settings | None = None) -> int:
    from chesspipe.automation import (
        automation_status,
        disable_schedule,
        enable_schedule,
        run_routine,
        tick,
    )

    try:
        if args.automation_action == "status":
            result = automation_status()
        elif args.automation_action == "disable":
            result = disable_schedule()
        elif args.automation_action == "run":
            result = run_routine(trigger="manual")
        elif args.automation_action == "tick":
            result = tick()
        else:
            result = enable_schedule({
                "preset": args.preset,
                "frequency": args.frequency,
                "hour": args.hour,
                "weekday": args.weekday,
                "analyze_count": args.analyze_count,
                "puzzle_count": args.puzzle_count,
            })
    except RuntimeError as exc:
        _print({"status": "error", "detail": str(exc)})
        return 1
    _print(result)
    return 1 if result.get("status") in {"error", "failed"} else 0


def _cmd_preview(args: argparse.Namespace, settings: Settings) -> int:
    from chesspipe.storage import get_connection
    from chesspipe.engine import build_engine
    from chesspipe.puzzle.build import generate_records
    from chesspipe.puzzle.lichess import GeneratorConfig, LichessStyleGenerator
    from chesspipe.puzzle.render_html import render_gallery

    engine = build_engine(settings)
    generator = LichessStyleGenerator(
        engine,
        GeneratorConfig(
            max_candidates=settings.puzzle_max_candidates,
            max_solution_plies=settings.puzzle_max_solution_plies,
            fallback_min_solution_plies=(
                settings.puzzle_fallback_min_plies or None
            ),
            allow_mate_in_one=settings.puzzle_fallback_min_plies == 1,
        ),
    )
    records: list[dict] = []
    try:
        engine.health()
        with get_connection(settings.database_url, settings.db_schema) as conn:
            for rec in generate_records(conn, generator, limit_games=args.limit_games, log=print):
                if args.phase and rec["phase"] != args.phase:
                    continue
                records.append(rec)
    finally:
        engine.close()

    records.sort(key=lambda r: r["quality_score"], reverse=True)
    records = records[: args.limit]
    out_path = Path(args.out).resolve()
    out_path.write_text(render_gallery(records, title="Lichess-style puzzles"), encoding="utf-8")
    print(f"wrote {len(records)} puzzles to {out_path}")
    if not args.no_open:
        webbrowser.open(out_path.as_uri())
    return 0


def _cmd_position(args: argparse.Namespace, settings: Settings) -> int:
    """Analyze one FEN with the configured local Stockfish binary."""
    import chess

    from chesspipe.engine.local import LocalEngine

    try:
        board = chess.Board(args.fen)
    except ValueError as exc:
        print(json.dumps({"error": "invalid_fen", "detail": str(exc)}))
        return 2

    engine = LocalEngine(
        settings.stockfish_path,
        threads=settings.stockfish_threads,
        hash_mb=settings.stockfish_hash_mb,
        depth=args.depth,
        time_sec=args.time,
    )
    try:
        health = engine.health()
        lines = engine.analyse_position(board, multipv=args.multipv)
        payload_lines = []
        for rank, line in enumerate(lines, start=1):
            replay = board.copy(stack=False)
            pv_uci: list[str] = []
            pv_san: list[str] = []
            best_move_san = None
            for move in line.pv[: args.max_pv]:
                if move not in replay.legal_moves:
                    break
                full_move = replay.fullmove_number
                black_to_move = replay.turn == chess.BLACK
                san = replay.san(move)
                if best_move_san is None:
                    best_move_san = san
                pv_uci.append(move.uci())
                pv_san.append(
                    f"{full_move}... {san}" if black_to_move else f"{full_move}. {san}"
                )
                replay.push(move)

            relative_cp = line.score.score(mate_score=100_000) or 0
            relative_mate = line.score.mate()
            white_sign = 1 if board.turn == chess.WHITE else -1
            payload_lines.append(
                {
                    "rank": rank,
                    "scoreCp": relative_cp,
                    "whiteCp": relative_cp * white_sign,
                    "mate": relative_mate,
                    "whiteMate": (
                        relative_mate * white_sign
                        if relative_mate is not None
                        else None
                    ),
                    "bestMoveUci": pv_uci[0] if pv_uci else None,
                    "bestMoveSan": best_move_san,
                    "pvUci": pv_uci,
                    "pvSan": pv_san,
                }
            )

        print(
            json.dumps(
                {
                    "engine": health.get("engine", "Stockfish"),
                    "depth": args.depth,
                    "timeSec": args.time,
                    "multipv": args.multipv,
                    "sideToMove": "white" if board.turn == chess.WHITE else "black",
                    "fen": board.fen(),
                    "lines": payload_lines,
                }
            )
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": "engine_failed", "detail": str(exc)}))
        return 1
    finally:
        engine.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="openfile", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_setup = sub.add_parser("setup", help="Configure Chess.com, SQLite, and local Stockfish")
    p_setup.add_argument("--chesscom", help="Chess.com username")
    p_setup.add_argument("--stockfish", help="Path to the Stockfish executable")
    p_setup.add_argument("--lichess-key", help="Optional Lichess OAuth token for opening-book enrichment")
    p_setup.add_argument("--lang", choices=("en", "ko"), default="en")
    p_setup.add_argument("--yes", action="store_true", help="Do not prompt; require command-line values")
    p_setup.set_defaults(func=_cmd_setup)

    sub.add_parser("doctor", help="Check configuration, SQLite, Stockfish, and Node.js").set_defaults(func=_cmd_doctor)

    p_config = sub.add_parser("config", help="View or change an advanced setting")
    config_sub = p_config.add_subparsers(dest="config_action", required=True)
    config_sub.add_parser("list", help="Show configured values").set_defaults(func=_cmd_config, key=None, value=None)
    config_sub.add_parser("path", help="Show the personal config path").set_defaults(func=_cmd_config, key=None, value=None)
    config_get = config_sub.add_parser("get", help="Read one setting")
    config_get.add_argument("key")
    config_get.set_defaults(func=_cmd_config, value=None)
    config_set = config_sub.add_parser("set", help="Change one setting")
    config_set.add_argument("key")
    config_set.add_argument("value")
    config_set.set_defaults(func=_cmd_config)

    p_automation = sub.add_parser(
        "automation",
        help="Schedule friendly sync, review, and puzzle routines",
    )
    automation_sub = p_automation.add_subparsers(dest="automation_action", required=True)
    automation_sub.add_parser("status", help="Show schedule and last-run status").set_defaults(func=_cmd_automation)
    automation_enable = automation_sub.add_parser("enable", help="Enable or update the native user schedule")
    automation_enable.add_argument("--preset", choices=("sync", "review", "puzzles"), default="puzzles")
    automation_enable.add_argument(
        "--frequency",
        choices=("every_6_hours", "every_12_hours", "daily", "weekly"),
        default="daily",
    )
    automation_enable.add_argument("--hour", type=int, choices=range(24), default=9)
    automation_enable.add_argument("--weekday", type=int, choices=range(7), default=0)
    automation_enable.add_argument("--analyze-count", type=int, choices=range(1, 11), default=2)
    automation_enable.add_argument("--puzzle-count", type=int, choices=range(1, 11), default=2)
    automation_enable.set_defaults(func=_cmd_automation)
    automation_sub.add_parser("disable", help="Turn off and remove the native schedule").set_defaults(func=_cmd_automation)
    automation_sub.add_parser("run", help="Run the configured routine immediately").set_defaults(func=_cmd_automation)
    automation_sub.add_parser("tick", help="Internal due check used by the native scheduler").set_defaults(func=_cmd_automation)

    p_ingest = sub.add_parser("ingest", help="Sync Chess.com games")
    p_ingest.add_argument(
        "--force",
        action="store_true",
        help="Refresh recent games already stored instead of importing only new URLs.",
    )
    p_ingest.add_argument("--months", type=int, default=None, help="Recent Chess.com archive months to inspect.")
    p_ingest.add_argument("--max-games", type=int, default=None, help="Maximum recent games to compare.")
    p_ingest.add_argument("--sync-run-id", type=int, default=None, help=argparse.SUPPRESS)
    p_ingest.set_defaults(func=_cmd_ingest)

    p_import = sub.add_parser("import-game", help="Import one Chess.com game link")
    p_import.add_argument("--url", required=True, help="Chess.com live or daily game URL")
    p_import.set_defaults(func=_cmd_import_game)

    p_select = sub.add_parser("select", help="Claim next game(s) to analyze")
    p_select.add_argument("--limit", type=int, default=1)
    p_select.set_defaults(func=_cmd_select)

    p_analyze = sub.add_parser("analyze", help="Analyze one selected game")
    p_analyze.add_argument(
        "--player-game-id",
        type=int,
        default=None,
        help="Analyze a specific player_games row (used by the web Game Review flow).",
    )
    p_analyze.add_argument(
        "--force",
        action="store_true",
        help="Refresh an existing review with the current engine and classification rules.",
    )
    p_analyze.set_defaults(func=_cmd_analyze)
    p_generate = sub.add_parser("generate", help="Cook one analyzed game")
    p_generate.add_argument(
        "--retry-no-puzzle",
        action="store_true",
        help="Retry one historical no_puzzle game with the current generator settings.",
    )
    p_generate.set_defaults(func=_cmd_generate)
    sub.add_parser("run", help="Run ingest->select->analyze->generate once").set_defaults(func=_cmd_run)

    p_prev = sub.add_parser("preview", help="Render puzzles to a local HTML gallery")
    p_prev.add_argument("--limit-games", type=int, default=None, help="Max analyzed games to scan.")
    p_prev.add_argument("--phase", choices=("opening", "middlegame", "endgame"), default=None)
    p_prev.add_argument("--limit", type=int, default=50, help="Max puzzles in the gallery.")
    p_prev.add_argument("--out", default="puzzles.html")
    p_prev.add_argument("--no-open", action="store_true")
    p_prev.set_defaults(func=_cmd_preview)

    p_position = sub.add_parser(
        "position",
        help="Analyze one FEN with the configured local Stockfish",
    )
    p_position.add_argument("--fen", required=True)
    p_position.add_argument("--depth", type=int, default=14, choices=range(8, 23))
    p_position.add_argument("--multipv", type=int, default=3, choices=range(1, 6))
    p_position.add_argument("--time", type=float, default=1.5)
    p_position.add_argument("--max-pv", type=int, default=12)
    p_position.set_defaults(func=_cmd_position)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command in ("setup", "doctor", "config", "automation"):
        return args.func(args, None)
    settings = Settings.from_env()
    return args.func(args, settings)


if __name__ == "__main__":
    sys.exit(main())
