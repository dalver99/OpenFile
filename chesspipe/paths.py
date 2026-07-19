"""Cross-platform locations for OpenFile configuration and data."""

from __future__ import annotations

import os
import platform
from pathlib import Path

APP_NAME = "OpenFile"
LEGACY_APP_NAME = "Rookline"


def _override(primary: str, legacy: str) -> str | None:
    return os.getenv(primary) or os.getenv(legacy)


def _platform_config_dir(app_name: str, linux_name: str) -> Path:
    system = platform.system()
    if system == "Windows":
        return Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming")) / app_name
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / app_name
    return Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / linux_name


def _platform_data_dir(app_name: str, linux_name: str) -> Path:
    system = platform.system()
    if system == "Windows":
        return Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / app_name
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / app_name
    return Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share")) / linux_name


def config_dir() -> Path:
    override = _override("OPENFILE_CONFIG_DIR", "ROOKLINE_CONFIG_DIR")
    if override:
        return Path(override).expanduser()
    return _platform_config_dir(APP_NAME, "openfile")


def data_dir() -> Path:
    override = _override("OPENFILE_DATA_DIR", "ROOKLINE_DATA_DIR")
    if override:
        return Path(override).expanduser()
    return _platform_data_dir(APP_NAME, "openfile")


def config_path() -> Path:
    override = _override("OPENFILE_CONFIG", "ROOKLINE_CONFIG")
    if override:
        return Path(override).expanduser()
    if _override("OPENFILE_CONFIG_DIR", "ROOKLINE_CONFIG_DIR"):
        return config_dir() / "config.json"
    preferred = config_dir() / "config.json"
    legacy = _platform_config_dir(LEGACY_APP_NAME, "rookline") / "config.json"
    return preferred if preferred.exists() or not legacy.exists() else legacy


def database_path() -> Path:
    override = _override("OPENFILE_DATABASE_PATH", "ROOKLINE_DATABASE_PATH")
    if override:
        return Path(override).expanduser()
    if _override("OPENFILE_DATA_DIR", "ROOKLINE_DATA_DIR"):
        return data_dir() / "openfile.db"
    preferred = data_dir() / "openfile.db"
    legacy = _platform_data_dir(LEGACY_APP_NAME, "rookline") / "rookline.db"
    return preferred if preferred.exists() or not legacy.exists() else legacy


def automation_dir() -> Path:
    return data_dir() / "automation"


def automation_config_path() -> Path:
    return automation_dir() / "schedule.json"


def automation_state_path() -> Path:
    return automation_dir() / "state.json"


def automation_log_path() -> Path:
    return automation_dir() / "automation.log"
