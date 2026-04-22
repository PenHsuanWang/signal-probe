import json
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    channel_names: list[str] = Field(default_factory=list)
    time_column: str | None = None
    signal_columns: list[str] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("channel_names", mode="before")
    @classmethod
    def _coerce_channel_names(cls, v: object) -> list[str]:
        """Accept NULL (new rows), JSON text, or an already-decoded list."""
        if v is None:
            return []
        if isinstance(v, str):
            try:
                decoded = json.loads(v)
                if isinstance(decoded, list):
                    return decoded
            except Exception:
                pass
            return []
        if isinstance(v, list):
            return v
        return []

    @field_validator("signal_columns", mode="before")
    @classmethod
    def _coerce_signal_columns(cls, v: object) -> list[str] | None:
        """Accept NULL, JSON text, or an already-decoded list."""
        if v is None:
            return None
        if isinstance(v, str):
            try:
                decoded = json.loads(v)
                if isinstance(decoded, list):
                    return decoded
            except Exception:
                pass
            return None
        if isinstance(v, list):
            return v
        return None


class SignalRenameRequest(BaseModel):
    original_filename: str = Field(..., min_length=1, max_length=500)


# ── Column inspection ──────────────────────────────────────────────────────────


class ColumnDescriptor(BaseModel):
    """Lightweight descriptor for a single column in the raw uploaded file."""

    name: str
    dtype: Literal["temporal", "numeric", "string", "boolean"]
    sample_values: list[str] = Field(default_factory=list)  # up to 3 non-null values
    null_count: int = 0
    is_candidate_time: bool = False


class RawColumnsResponse(BaseModel):
    signal_id: uuid.UUID
    columns: list[ColumnDescriptor]


# ── Column configuration / process ────────────────────────────────────────────


class ProcessSignalRequest(BaseModel):
    time_column: str = Field(..., min_length=1, max_length=255)
    signal_columns: list[str] = Field(..., min_length=1)

    @field_validator("signal_columns")
    @classmethod
    def _no_empty_names(cls, v: list[str]) -> list[str]:
        if any(not s.strip() for s in v):
            raise ValueError("signal_columns must not contain empty strings")
        return v


# ── Macro view ─────────────────────────────────────────────────────────────────


class RunBound(BaseModel):
    run_id: uuid.UUID
    run_index: int
    start_x: float
    end_x: float
    ooc_count: int

    model_config = ConfigDict(from_attributes=True)


class ChannelMacroData(BaseModel):
    channel_name: str
    y: list[float]
    states: list[str]


class MacroViewResponse(BaseModel):
    signal_id: uuid.UUID
    x: list[float]  # shared timestamp axis (LTTB-downsampled on primary channel)
    channels: list[ChannelMacroData]
    runs: list[RunBound]


# ── Run chunk ──────────────────────────────────────────────────────────────────


class ChannelChunkData(BaseModel):
    channel_name: str
    y: list[float]
    states: list[str]


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
    channels: list[ChannelChunkData]
