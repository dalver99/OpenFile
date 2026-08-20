import "server-only";

type RuntimeSettings = {
  language?: string;
  stockfish_path?: string | null;
  stockfish_threads?: number;
  stockfish_hash_mb?: number;
};

export async function runtimeSettings(): Promise<RuntimeSettings> {
  return {
    language: "en",
    stockfish_path: null,
    stockfish_threads: 0,
    stockfish_hash_mb: 0,
  };
}
