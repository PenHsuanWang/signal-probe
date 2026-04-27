"""STFTService: application-layer orchestrator for spectral analysis.

Responsibilities:
  1. Validate signal ownership and COMPLETED status (via SignalRepository).
  2. Locate and read the processed Parquet file (via IStorageAdapter + Polars).
  3. Infer sampling rate from the timestamp column.
  4. Slice the signal to the requested time window.
  5. Delegate pure computation to the STFTEngine (domain layer) running in a
     ``ProcessPoolExecutor`` worker process (see ``app.infrastructure.executor``).
  6. Assemble and return response DTOs.

Concurrency model
-----------------
Both ``get_stft`` and ``get_spectrogram`` are async methods that offload their
CPU-bound computation via::

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(get_executor(), fn, *args)

This keeps the asyncio event loop completely non-blocking: while a heavy
spectrogram is being computed in a worker process, the server can continue
serving other HTTP requests.  The worker process uses ``scipy.fft.rfft`` with
``workers=-1`` internally, which spawns pocketfft threads to saturate all
available CPU cores for large transform sizes.

This class must NOT import FastAPI, Pydantic HTTP models, or any presentation-
layer concern.  Errors are raised as plain Python exceptions and mapped to HTTP
status codes by the router.
"""

from __future__ import annotations

# Environment-controlled payload cap: raise 413 if the spectrogram
# response would exceed this many megabytes.  0 = unlimited.
import asyncio
import os as _os
import uuid

import numpy as np
import polars as pl
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictException,
    NotFoundException,
    ValidationException,
)
from app.domain.analysis.schemas import (
    SpectrogramConfig,
    SpectrogramResponse,
    STFTResponse,
    STFTWindowConfig,
)
from app.domain.analysis.stft_engine import compute_spectrogram, compute_stft
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.repository import SignalRepository
from app.infrastructure.executor import get_executor
from app.infrastructure.storage.interface import IStorageAdapter

_MAX_RESPONSE_MB: float = float(_os.environ.get("STFT_MAX_RESPONSE_MB", "50"))


class STFTService:
    def __init__(self, session: AsyncSession, storage: IStorageAdapter) -> None:
        self._repo = SignalRepository(session)
        self._storage = storage

    # ── Public use-cases ────────────────────────────────────────────────────

    async def get_stft(
        self,
        signal_id: uuid.UUID,
        channel_name: str,
        config: STFTWindowConfig,
        owner_id: uuid.UUID,
    ) -> STFTResponse:
        """Compute the FFT magnitude spectrum for a single time window.

        Args:
            signal_id: UUID of the signal to analyse.
            channel_name: Name of the channel column in the Parquet file.
            config: Window bounds and FFT parameters.
            owner_id: ID of the authenticated user (ownership check).

        Returns:
            :class:`STFTResponse` DTO.

        Raises:
            NotFoundException: Signal or channel not found.
            ConflictException: Signal is not in COMPLETED state.
        """
        parquet_path, sampling_rate_hz = await self._load_channel_meta(
            signal_id, channel_name, owner_id
        )

        timestamps, amplitudes = _read_two_columns(
            parquet_path, "timestamp_s", channel_name
        )

        # Clamp end_s to signal boundary without raising.
        t_max = float(timestamps[-1])
        end_s = min(config.end_s, t_max)
        if config.start_s >= end_s:
            raise ValidationException(
                f"start_s ({config.start_s}) is at or beyond the signal end "
                f"({t_max:.3f} s).  Choose a smaller start_s."
            )

        mask = (timestamps >= config.start_s) & (timestamps <= end_s)
        segment = amplitudes[mask]

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            get_executor(), compute_stft, segment, sampling_rate_hz, config
        )

        return STFTResponse(
            signal_id=str(signal_id),
            channel_name=channel_name,
            frequencies_hz=result.frequencies_hz.tolist(),
            magnitudes=result.magnitudes.tolist(),
            dominant_frequency_hz=result.dominant_frequency_hz,
            window_config=config,
            sampling_rate_hz=sampling_rate_hz,
        )

    async def get_spectrogram(
        self,
        signal_id: uuid.UUID,
        channel_name: str,
        config: SpectrogramConfig,
        owner_id: uuid.UUID,
    ) -> SpectrogramResponse:
        """Compute the full-signal sliding-window spectrogram.

        Args:
            signal_id: UUID of the signal to analyse.
            channel_name: Name of the channel column in the Parquet file.
            config: Spectrogram parameters (window function, size, hop size).
            owner_id: ID of the authenticated user (ownership check).

        Returns:
            :class:`SpectrogramResponse` DTO.

        Raises:
            NotFoundException: Signal or channel not found.
            ConflictException: Signal is not in COMPLETED state.
            ValueError: Response payload would exceed STFT_MAX_RESPONSE_MB.
        """
        parquet_path, sampling_rate_hz = await self._load_channel_meta(
            signal_id, channel_name, owner_id
        )

        _, amplitudes = _read_two_columns(parquet_path, "timestamp_s", channel_name)

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            get_executor(), compute_spectrogram, amplitudes, sampling_rate_hz, config
        )

        # Payload size guard (n_time × n_freq × 8 bytes per float64).
        n_time, n_freq = result.magnitude_db.shape
        payload_mb = (n_time * n_freq * 8) / (1024 * 1024)
        if _MAX_RESPONSE_MB > 0 and payload_mb > _MAX_RESPONSE_MB:
            raise ValidationException(
                f"Spectrogram payload ({payload_mb:.1f} MB) exceeds the "
                f"{_MAX_RESPONSE_MB:.0f} MB limit.  Increase hop_size or "
                "reduce window_size to shrink the response."
            )

        return SpectrogramResponse(
            signal_id=str(signal_id),
            channel_name=channel_name,
            time_bins_s=result.time_bins_s.tolist(),
            frequency_bins_hz=result.frequency_bins_hz.tolist(),
            magnitude_db=result.magnitude_db.tolist(),
            sampling_rate_hz=sampling_rate_hz,
            downsampled=result.downsampled,
        )

    # ── Private helpers ──────────────────────────────────────────────────────

    async def _load_channel_meta(
        self,
        signal_id: uuid.UUID,
        channel_name: str,
        owner_id: uuid.UUID,
    ) -> tuple[str, float]:
        """Validate ownership, status, and channel; return (parquet_path, sr_hz)."""
        signal = await self._repo.get_signal(signal_id)

        if signal is None or signal.owner_id != owner_id:
            raise NotFoundException("Signal not found")

        if signal.status != ProcessingStatus.COMPLETED:
            raise ConflictException(
                f"Spectral analysis requires a COMPLETED signal "
                f"(current status: {signal.status})"
            )

        import json as _json

        channel_names: list[str] = (
            _json.loads(signal.channel_names)
            if isinstance(signal.channel_names, str)
            else (signal.channel_names or [])
        )
        if channel_name not in channel_names:
            raise NotFoundException(
                f"Channel '{channel_name}' not found. "
                f"Available channels: {channel_names}"
            )

        if not signal.processed_file_path:
            raise NotFoundException("Processed Parquet file not found for this signal")

        timestamps, _ = _read_two_columns(
            signal.processed_file_path, "timestamp_s", channel_name
        )
        sampling_rate_hz = _infer_sampling_rate(timestamps)

        return signal.processed_file_path, sampling_rate_hz


# ── Module-level pure helpers (no self dependency — easier to unit-test) ────


def _read_two_columns(
    parquet_path: str,
    ts_col: str,
    channel_col: str,
) -> tuple[np.ndarray, np.ndarray]:
    """Read two columns from a Parquet file via a Polars lazy scan.

    Uses ``scan_parquet`` with column projection so only the two requested
    columns are loaded into memory, regardless of how wide the Parquet file is.

    Returns:
        Tuple of (timestamps, amplitudes) as float64 NumPy arrays.
    """
    df = pl.scan_parquet(parquet_path).select([ts_col, channel_col]).collect()
    timestamps = df[ts_col].cast(pl.Float64).to_numpy()
    amplitudes = df[channel_col].cast(pl.Float64).to_numpy()
    return timestamps, amplitudes


def _infer_sampling_rate(timestamps: np.ndarray) -> float:
    """Estimate uniform sampling rate from the median inter-sample interval.

    Using the median (rather than mean) makes the estimate robust to a small
    number of irregular gaps (e.g., logger restarts, dropped frames).

    Args:
        timestamps: Sorted 1-D array of sample timestamps in seconds.

    Returns:
        Estimated sampling rate in Hz (float).

    Raises:
        ValueError: If fewer than 2 timestamps are provided.
    """
    if len(timestamps) < 2:
        raise ValidationException(
            "Cannot infer sampling rate: signal must contain at least 2 samples"
        )
    diffs = np.diff(timestamps)
    median_dt = float(np.median(diffs))
    if median_dt <= 0:
        raise ValidationException(
            f"Median inter-sample interval is non-positive ({median_dt:.6f} s). "
            "Timestamps must be monotonically increasing."
        )
    return 1.0 / median_dt
