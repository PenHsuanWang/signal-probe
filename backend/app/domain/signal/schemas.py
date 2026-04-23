import json
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.signal.enums import ProcessingStatus

# ── Upload / List ──────────────────────────────────────────────────────────────


class SignalMetadataResponse(BaseModel):
    id: uuid.UUID
    original_filename: str
    status: ProcessingStatus
    total_points: int | None
    active_run_count: int
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
    csv_format: Literal["wide", "stacked"] = "wide"
    # Detected CSV format: 'wide' (one column per channel) or 'stacked' (long format).
    stacked_signal_names: list[str] = Field(default_factory=list)
    # Unique signal names found in the signal_name column (stacked format only).


# ── Column configuration / process ────────────────────────────────────────────


class ProcessSignalRequest(BaseModel):
    csv_format: Literal["wide", "stacked"] = "wide"
    # Format of the raw CSV: 'wide' (one column per channel) or 'stacked' (long format).

    # Wide-format fields (required when csv_format == "wide")
    time_column: str | None = Field(None, min_length=1, max_length=255)
    signal_columns: list[str] | None = None

    # Stacked-format field (optional — None means include all available channels)
    stacked_channel_filter: list[str] | None = None
    # Subset of signal names to include from a stacked CSV (None = all channels).

    # Explicit datetime column for the x-axis (stacked format).
    # When omitted the pipeline falls back to alias-based column detection.
    datetime_column: str | None = Field(None, min_length=1, max_length=255)

    # Optional column containing physical unit strings (e.g. "mV", "°C").
    # Applies to both wide and stacked formats; None means no unit labels.
    unit_column: str | None = Field(None, min_length=1, max_length=255)

    @model_validator(mode="after")
    def _validate_format_fields(self) -> "ProcessSignalRequest":
        if self.csv_format == "wide":
            if not self.time_column:
                raise ValueError("time_column is required for wide format")
            if not self.signal_columns:
                raise ValueError("signal_columns is required for wide format")
            if any(not s.strip() for s in self.signal_columns):
                raise ValueError("signal_columns must not contain empty strings")
            if self.unit_column and self.unit_column == self.time_column:
                raise ValueError("unit_column cannot be the same as time_column")
            if self.unit_column and self.unit_column in self.signal_columns:
                raise ValueError("unit_column cannot appear in signal_columns")
        elif self.csv_format == "stacked":
            if self.stacked_channel_filter is not None:
                if not self.stacked_channel_filter:
                    raise ValueError(
                        "stacked_channel_filter must not be an empty list "
                        "(use null/omit to include all channels)"
                    )
                if any(not s.strip() for s in self.stacked_channel_filter):
                    raise ValueError(
                        "stacked_channel_filter must not contain empty strings"
                    )
        return self


# ── Macro view ─────────────────────────────────────────────────────────────────


class RunBound(BaseModel):
    run_id: uuid.UUID
    run_index: int
    start_x: float
    end_x: float

    model_config = ConfigDict(from_attributes=True)


class ChannelMacroData(BaseModel):
    channel_name: str
    y: list[float]
    states: list[str]


class MacroViewResponse(BaseModel):
    signal_id: uuid.UUID
    x: list[float]  # shared timestamp axis (elapsed seconds from first point)
    channels: list[ChannelMacroData]
    runs: list[RunBound]
    t0_epoch_s: float | None = None
    # Unix epoch of the first timestamp (seconds).  Set when the time column
    # is temporal; None for purely numeric time axes.  Allows the frontend to
    # reconstruct absolute datetime labels as: datetime(t0_epoch_s + x[i]).
    channel_units: dict[str, str] = Field(default_factory=dict)
    # Maps channel name → physical unit string (e.g. {"pressure": "psig"}).
    # Present only when the user mapped a unit column during processing;
    # omitted channels should be treated as unitless.


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
    x: list[float]
    channels: list[ChannelChunkData]
