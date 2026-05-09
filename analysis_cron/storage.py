import json
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any


class LocalStorage:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.runs_dir = data_dir / "runs"
        self.analyses_dir = data_dir / "analyses"
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.analyses_dir.mkdir(parents=True, exist_ok=True)

    def already_ran_today(self, run_date: date) -> bool:
        return self.run_marker_path(run_date).exists()

    def mark_run(self, run_date: date, payload: dict[str, Any]) -> Path:
        path = self.run_marker_path(run_date)
        self._write_json(path, payload)
        return path

    def run_marker_path(self, run_date: date) -> Path:
        return self.runs_dir / f"{run_date.isoformat()}.json"

    def analyzed_game_urls(self) -> set[str]:
        urls: set[str] = set()
        for path in self.analyses_dir.rglob("*.json"):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    payload = json.load(handle)
            except (OSError, json.JSONDecodeError):
                continue
            game_url = payload.get("game", {}).get("url")
            if game_url:
                urls.add(game_url)
        return urls

    def save_analysis(self, username: str, run_date: date, game_url: str, payload: dict[str, Any]) -> Path:
        game_id = game_url.rstrip("/").split("/")[-1]
        path = self.analyses_dir / username.lower() / run_date.isoformat() / f"{game_id}.json"
        self._write_json(path, payload)
        return path

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        serializable = _to_jsonable(payload)
        temp_path = path.with_suffix(f"{path.suffix}.tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(serializable, handle, indent=2, sort_keys=True)
            handle.write("\n")
        temp_path.replace(path)


def _to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _to_jsonable(asdict(value))
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value

