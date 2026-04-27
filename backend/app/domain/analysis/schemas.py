"""Pydantic v2 schemas for the Spectral Analysis bounded context.

These are the only models allowed in the domain layer — no FastAPI, SQLAlchemy,
or Polars imports are permitted here (Clean Architecture: domain has zero
external framework dependencies).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class WindowFunction(StrEnum):
    """All scipy.signal.get_window-compatible window function names."""

    hann = "hann"
    hamming = "hamming"
    blackman = "blackman"
    bartlett = "bartlett"
    flattop = "flattop"
    parzen = "parzen"
    bohman = "bohman"
    blackmanharris = "blackmanharris"
    nuttall = "nuttall"
    barthann = "barthann"
    cosine = "cosine"
    exponential = "exponential"
    tukey = "tukey"
    taylor = "taylor"
    boxcar = "boxcar"  # rectangular — no tapering, causes spectral leakage


def _is_power_of_two(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


class STFTWindowConfig(BaseModel):
    """Parameters describing a single STFT analysis window."""

    start_s: float = Field(..., description="Window start time in seconds from t=0")
    end_s: float = Field(..., description="Window end time in seconds from t=0")
    window_fn: WindowFunction = Field(
        WindowFunction.hann, description="Window function applied before FFT"
    )
    window_size: int = Field(
        1024,
        ge=4,
        le=131072,
        description="FFT transform length in samples (must be a power of 2)",
    )

    @model_validator(mode="after")
    def _validate_window_bounds(self) -> STFTWindowConfig:
        if self.start_s >= self.end_s:
            raise ValueError(
                f"start_s ({self.start_s}) must be strictly less than "
                f"end_s ({self.end_s})"
            )
        if not _is_power_of_two(self.window_size):
            raise ValueError(f"window_size ({self.window_size}) must be a power of 2")
        return self


class SpectrogramConfig(BaseModel):
    """Parameters for computing a full-signal spectrogram."""

    window_fn: WindowFunction = Field(
        WindowFunction.hann, description="Window function applied to each frame"
    )
    window_size: int = Field(
        1024,
        ge=4,
        le=131072,
        description="FFT frame length in samples (must be a power of 2)",
    )
    hop_size: int = Field(
        512,
        ge=1,
        description="Number of samples to advance between successive frames",
    )

    @model_validator(mode="after")
    def _validate_hop(self) -> SpectrogramConfig:
        if not _is_power_of_two(self.window_size):
            raise ValueError(f"window_size ({self.window_size}) must be a power of 2")
        if self.hop_size > self.window_size:
            raise ValueError(
                f"hop_size ({self.hop_size}) must be ≤ window_size ({self.window_size})"
            )
        return self


class STFTResponse(BaseModel):
    """Response payload for a single STFT window analysis."""

    signal_id: str
    channel_name: str
    frequencies_hz: list[float]
    magnitudes: list[float]
    dominant_frequency_hz: float | None = None
    window_config: STFTWindowConfig
    sampling_rate_hz: float


class SpectrogramResponse(BaseModel):
    """Response payload for a full-signal spectrogram computation."""

    signal_id: str
    channel_name: str
    time_bins_s: list[float]
    frequency_bins_hz: list[float]
    magnitude_db: list[list[float]]  # shape: [n_time_bins × n_freq_bins]
    sampling_rate_hz: float
    downsampled: bool = Field(
        False,
        description="True when the time axis was automatically reduced to 2,000 bins",
    )
