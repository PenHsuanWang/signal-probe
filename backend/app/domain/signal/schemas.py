import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.domain.signal.enums import ProcessingStatus

# ── Upload / List ──────────────────────────────────────────────────────────────


class SignalMetadataResponse(BaseModel):
    id: uuid.UUID
    original_filename: str
    status: ProcessingStatus
    total_points: int | None
    active_run_count: int
    ooc_count: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Macro view ─────────────────────────────────────────────────────────────────


class RunBound(BaseModel):
    run_id: uuid.UUID
    run_index: int
    start_x: float
    end_x: float
    ooc_count: int

    model_config = ConfigDict(from_attributes=True)


class MacroViewResponse(BaseModel):
    signal_id: uuid.UUID
    x: list[float]
    y: list[float]
    states: list[str]
    runs: list[RunBound]


# ── Run chunk ──────────────────────────────────────────────────────────────────


class RunChunkResponse(BaseModel):
    run_id: uuid.UUID
    run_index: int
    duration_seconds: float | None
    value_max: float | None
    value_min: float | None
    value_mean: float | None
    value_variance: float | None
    ooc_count: int
    x: list[float]
    y: list[float]
    states: list[str]
