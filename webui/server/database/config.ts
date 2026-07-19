import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type LocalConfig = {
  chesscom_username?: string;
  database_path?: string;
  language?: string;
  lichess_api_key?: string;
  max_sync_games?: number;
  recent_archive_months?: number;
  target_user_id?: number;
  analysis_depth?: number;
  analysis_multipv?: number;
  analysis_deep_depth?: number;
  analysis_deep_multipv?: number;
  analysis_deep_max_moves?: number;
};

function defaultConfigPath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "OpenFile", "config.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "OpenFile", "config.json");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "openfile", "config.json");
}

function legacyConfigPath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Rookline", "config.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Rookline", "config.json");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "rookline", "config.json");
}

export function localConfig(): LocalConfig {
  const explicit = process.env.OPENFILE_CONFIG?.trim() || process.env.ROOKLINE_CONFIG?.trim();
  const preferred = defaultConfigPath();
  const configPath = explicit || (fs.existsSync(preferred) ? preferred : legacyConfigPath());
  try {
    return JSON.parse(
      fs.readFileSync(/* turbopackIgnore: true */ configPath, "utf8"),
    ) as LocalConfig;
  } catch {
    return {};
  }
}

export function databasePath(): string {
  const configured = process.env.OPENFILE_DATABASE_PATH?.trim()
    || process.env.ROOKLINE_DATABASE_PATH?.trim()
    || localConfig().database_path;
  if (!configured) {
    throw new Error("OpenFile is not configured. Run `openfile setup`, then restart the web UI.");
  }
  return path.resolve(/* turbopackIgnore: true */ configured);
}

export function lichessApiKey(): string | null {
  return (process.env.LICHESS_API_KEY?.trim() || localConfig().lichess_api_key || "").trim() || null;
}
