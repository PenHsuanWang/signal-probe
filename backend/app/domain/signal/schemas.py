import json
import uuid
from datetime import datetime

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


class SignalRenameRequest(BaseModel):
    original_filename: str = Field(..., min_length=1, max_length=500)


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
