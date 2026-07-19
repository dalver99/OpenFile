import { spawn } from "node:child_process";

/** Shared configuration for API routes that invoke the local Python pipeline. */
export function localOperationsEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    || process.env.LOCAL_OPERATIONS_ENABLED === "true";
}

function projectRoot(): string {
  return process.env.CHESSPIPE_ROOT?.trim() || "..";
}

function pythonExecutable(): string {
  return process.env.CHESSPIPE_PYTHON?.trim()
    || (process.platform === "win32"
      ? ".venv\\Scripts\\python.exe"
      : ".venv/bin/python");
}

function workerEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

export function spawnChesspipe(
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = {},
) {
  return spawn(pythonExecutable(), args, {
    cwd: projectRoot(),
    env: workerEnvironment(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function spawnDetachedChesspipe(
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = {},
) {
  return spawn(pythonExecutable(), args, {
    cwd: projectRoot(),
    env: workerEnvironment(env),
    detached: true,
    stdio: "ignore",
  });
}
