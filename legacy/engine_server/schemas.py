from typing import Optional

from pydantic import BaseModel, Field


class PositionRequest(BaseModel):
    fen: Optional[str] = Field(
        default=None,
        description="Board state in FEN format. Defaults to initial position.",
    )
    moves: list[str] = Field(
        default_factory=list,
        description="Optional UCI moves to apply before analysis.",
    )


class BestMoveRequest(PositionRequest):
    movetime_ms: int = Field(default=100, ge=10, le=10_000)


class AnalyzeRequest(PositionRequest):
    depth: int = Field(default=12, ge=1, le=40)


class MultiPVAnalyzeRequest(PositionRequest):
    depth: int = Field(default=12, ge=1, le=40)
    p: int = Field(default=3, ge=1, le=10, description="Number of candidate lines to return.")


class StreamAnalyzeRequest(PositionRequest):
    max_depth: int = Field(default=21, ge=1, le=40)
    p: int = Field(default=3, ge=1, le=10, description="Number of candidate lines to stream.")


class GameAnalyzeRequest(BaseModel):
    pgn: Optional[str] = Field(default=None, description="Full PGN game text.")
    moves: list[str] = Field(
        default_factory=list,
        description="Full game as UCI moves. Used when PGN is omitted.",
    )
    start_fen: Optional[str] = Field(
        default=None,
        description="Optional starting FEN for UCI move lists. Defaults to the initial position.",
    )
    depth: int = Field(default=10, ge=1, le=30)
    p: int = Field(default=3, ge=1, le=10, description="Number of candidate lines to compare.")
    deep_depth: int = Field(default=20, ge=1, le=30)
    deep_p: int = Field(default=3, ge=1, le=10)
    deep_threshold_cp: int = Field(default=60, ge=1, le=10_000)
    deep_max_moves: int = Field(default=12, ge=0, le=200)
