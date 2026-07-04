import os

from dotenv import load_dotenv


load_dotenv()


def _positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return max(1, int(raw, 10))
    except ValueError:
        return default


APP_TITLE = "Stockfish FastAPI"
APP_VERSION = "0.1.0"
DEFAULT_STOCKFISH_PATH = os.path.expanduser("~/stockfish/stockfish-ubuntu-x86-64-avx2")
STOCKFISH_PATH = os.getenv("STOCKFISH_PATH", DEFAULT_STOCKFISH_PATH)
STOCKFISH_THREADS = _positive_int_env("STOCKFISH_THREADS", 1)
STOCKFISH_API_KEY = os.getenv("STOCKFISH_API_KEY")
LICHESS_API_KEY = os.getenv("LICHESS_API_KEY")
