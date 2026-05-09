"""REST API endpoints for STFT spectral analysis.

Routes:
    GET /signals/{signal_id}/analysis/stft
        Compute the FFT magnitude spectrum for a user-defined time window.

    GET /signals/{signal_id}/analysis/spectrogram
        Compute the full-signal sliding-window spectrogram.

Both endpoints:
  - Require Bearer JWT authentication.
  - Enforce signal ownership (request user must own the signal).
  - Return 409 if the signal is not yet COMPLETED.
  - Follow the project error envelope: {"error": {"code": ..., "message": ...}}.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query

from app.application.analysis.stft_service import STFTService
from app.domain.analysis.schemas import (
    SpectrogramConfig,
    SpectrogramResponse,
    STFTResponse,
    STFTWindowConfig,
    WindowFunction,
)
from app.presentation.api.dependencies import CurrentUser, DbSession, StorageDep

router = APIRouter()


@router.get(
    "/{signal_id}/analysis/stft",
    response_model=STFTResponse,
    summary="Compute FFT spectrum for a time window",
    tags=["analysis"],
)
async def get_stft(
    signal_id: uuid.UUID,
    channel_name: str = Query(
        ..., description="Channel column name in the Parquet file"
    ),
    start_s: float = Query(
        ..., description="Window start time in seconds from t=0", ge=0
    ),
    end_s: float = Query(..., description="Window end time in seconds from t=0", gt=0),
    window_fn: WindowFunction = Query(
        WindowFunction.hann,
        description="Window function applied before FFT (default: hann)",
    ),
    window_size: int = Query(
        1024,
        ge=4,
        le=131072,
        description="FFT transform length in samples (must be a power of 2)",
    ),
    session: DbSession = ...,
    storage: StorageDep = ...,
    current_user: CurrentUser = ...,
) -> STFTResponse:
    """Compute the one-sided FFT magnitude spectrum for a time window.

    The signal segment `[start_s, end_s]` is extracted from the processed
    Parquet file, optionally zero-padded to `window_size`, and transformed
    using the selected window function.

    - **channel_name**: Must be one of the signal's processed channel names.
    - **start_s / end_s**: Time bounds in seconds. `end_s` is clamped to the
      signal duration if it exceeds it.
    - **window_size**: Must be a power of 2 in the range [4, 131072].
    """
    config = STFTWindowConfig(
        start_s=start_s,
        end_s=end_s,
        window_fn=window_fn,
        window_size=window_size,
    )

    svc = STFTService(session, storage)
    return await svc.get_stft(
        signal_id=signal_id,
        channel_name=channel_name,
        config=config,
        owner_id=current_user.id,
    )


@router.get(
    "/{signal_id}/analysis/spectrogram",
    response_model=SpectrogramResponse,
    summary="Compute windowed spectrogram",
    tags=["analysis"],
)
async def get_spectrogram(
    signal_id: uuid.UUID,
    channel_name: str = Query(
        ..., description="Channel column name in the Parquet file"
    ),
    window_fn: WindowFunction = Query(
        WindowFunction.hann,
        description="Window function applied to each frame (default: hann)",
    ),
    window_size: int = Query(
        1024,
        ge=4,
        le=131072,
        description="FFT transform length in samples (must be a power of 2)",
    ),
    hop_size: int = Query(
        512,
        ge=1,
        description="Number of samples to advance between successive frames",
    ),
    start_s: float = Query(
        0.0,
        ge=0,
        description="Segment start time in seconds from t=0 (default: 0 = beginning)",
    ),
    end_s: float | None = Query(
        None,
        gt=0,
        description=(
            "Segment end time in seconds from t=0; omit to analyse the full signal"
        ),
    ),
    session: DbSession = ...,
    storage: StorageDep = ...,
    current_user: CurrentUser = ...,
) -> SpectrogramResponse:
    """Compute a sliding-window STFT spectrogram over an optional time window.

    Returns a time × frequency magnitude matrix in dBFS.  When the natural
    number of time bins exceeds 2,000, the time axis is uniformly downsampled
    and `downsampled: true` is set in the response.

    The `time_bins_s` values in the response are in the same elapsed-seconds
    coordinate as the signal's `timestamp_s` column — they reflect the absolute
    position within the signal, not the offset from `start_s`.

    - **start_s / end_s**: Optional time bounds. Omitting both analyses the full
      signal. `end_s` is clamped to the signal duration if it exceeds it.
    - **hop_size**: Controls overlap between frames. Smaller values produce
      more time bins (finer time resolution) at higher compute cost.
    - **window_size**: Must be a power of 2 in the range [4, 131072].
      `hop_size` must be ≤ `window_size`.
    """
    config = SpectrogramConfig(
        window_fn=window_fn,
        window_size=window_size,
        hop_size=hop_size,
        start_s=start_s,
        end_s=end_s,
    )

    svc = STFTService(session, storage)
    return await svc.get_spectrogram(
        signal_id=signal_id,
        channel_name=channel_name,
        config=config,
        owner_id=current_user.id,
    )
