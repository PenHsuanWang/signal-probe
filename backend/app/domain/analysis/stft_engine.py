"""Pure STFT computation engine.

This module has ZERO framework imports (no FastAPI, SQLAlchemy, Polars).
It accepts plain NumPy arrays and domain value objects, and returns
dataclass results.  This satisfies Clean Architecture: the domain layer
depends only on standard scientific libraries (numpy, scipy).

Performance design
------------------
``compute_spectrogram`` is designed for maximum throughput on large signals:

1. **Pre-selection** — when the natural frame count exceeds
   ``_MAX_SPECTROGRAM_BINS``, only the 2,000 frames that survive downsampling
   are computed.  This reduces work from O(all_frames) to O(2000) for large
   datasets and is the single biggest speedup for high-resolution signals.

2. **Vectorised frame matrix** — instead of a Python ``for``-loop, all frames
   are assembled in one NumPy advanced-indexing call
   ``signal[starts[:, None] + arange(size)]``, producing a 2-D
   ``(n_frames, window_size)`` array that is processed by a single FFT call.

3. **Multi-threaded FFT** — ``scipy.fft.rfft(windowed, axis=1, workers=-1)``
   invokes pocketfft with all available CPU threads, saturating every core for
   large transform sizes (≥ 32 k samples per the SciPy documentation).

These functions are designed to be called via
``asyncio.get_running_loop().run_in_executor(ProcessPoolExecutor, fn, ...)``
(see ``stft_service.py``), which offloads the entire computation to a worker
process and keeps the event loop fully non-blocking.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import scipy.fft as _scipy_fft
from scipy.signal import get_window  # type: ignore[import-untyped]

from app.domain.analysis.schemas import SpectrogramConfig, STFTWindowConfig

# Prevent log(0) in dBFS conversion.
_EPSILON: float = 1e-12

# Maximum number of time bins in a spectrogram response.
# Plotly heatmap visual resolution saturates well below 2000 columns.
_MAX_SPECTROGRAM_BINS: int = 2000


@dataclass(frozen=True)
class SpectrumResult:
    """One-sided FFT magnitude spectrum for a single window."""

    frequencies_hz: np.ndarray  # shape (n_freq,)  — float64
    magnitudes: np.ndarray  # shape (n_freq,)  — float64
    dominant_frequency_hz: float | None


@dataclass(frozen=True)
class SpectrogramResult:
    """Full-signal sliding-window spectrogram in dBFS."""

    time_bins_s: np.ndarray  # shape (n_time,)              — float64
    frequency_bins_hz: np.ndarray  # shape (n_freq,)              — float64
    magnitude_db: np.ndarray  # shape (n_time, n_freq)       — float64
    downsampled: bool


def compute_stft(
    signal_segment: np.ndarray,
    sampling_rate_hz: float,
    config: STFTWindowConfig,
) -> SpectrumResult:
    """Compute the one-sided real FFT magnitude spectrum of *signal_segment*.

    The segment is zero-padded to ``config.window_size`` when shorter, or
    truncated when longer.  A window function is applied before the FFT to
    reduce spectral leakage.

    Args:
        signal_segment: 1-D array of amplitude samples (any numeric dtype).
        sampling_rate_hz: Uniform sampling rate in Hz (must be > 0).
        config: STFT window parameters (start/end bounds already applied by
            the caller; this function does not re-slice by time).

    Returns:
        :class:`SpectrumResult` with ``frequencies_hz``, ``magnitudes``, and
        ``dominant_frequency_hz``.

    Raises:
        ValueError: If *signal_segment* has fewer than 4 samples.
    """
    n = len(signal_segment)
    if n < 4:
        raise ValueError(f"Signal segment too short: {n} sample(s). Minimum is 4.")

    size = config.window_size
    # Zero-pad if shorter than window_size; truncate if longer.
    if n < size:
        padded = np.zeros(size, dtype=np.float64)
        padded[:n] = signal_segment
        segment = padded
    else:
        segment = signal_segment[:size].astype(np.float64)

    win = get_window(config.window_fn.value, size)
    windowed = segment * win

    spectrum = _scipy_fft.rfft(windowed, workers=-1)
    freqs = _scipy_fft.rfftfreq(size, d=1.0 / sampling_rate_hz)
    mags = np.abs(spectrum)

    dominant = float(freqs[int(np.argmax(mags))]) if mags.max() > 0 else None

    return SpectrumResult(
        frequencies_hz=freqs,
        magnitudes=mags,
        dominant_frequency_hz=dominant,
    )


def compute_spectrogram(
    signal: np.ndarray,
    sampling_rate_hz: float,
    config: SpectrogramConfig,
) -> SpectrogramResult:
    """Compute a sliding-window STFT spectrogram over the full *signal*.

    Each frame of length ``config.window_size`` is advanced by
    ``config.hop_size`` samples.  Magnitudes are converted to dBFS:
    ``20 × log₁₀(|X| / max(|X|) + ε)``.

    When the natural number of time bins exceeds ``_MAX_SPECTROGRAM_BINS``,
    the time axis is uniformly downsampled and ``downsampled=True`` is set in
    the result.

    Args:
        signal: Full 1-D signal array (any numeric dtype).
        sampling_rate_hz: Uniform sampling rate in Hz (must be > 0).
        config: Spectrogram parameters (window function, size, hop size).

    Returns:
        :class:`SpectrogramResult` with ``time_bins_s``, ``frequency_bins_hz``,
        ``magnitude_db``, and ``downsampled``.

    Raises:
        ValueError: If *signal* has fewer than ``config.window_size`` samples.
    """
    size = config.window_size
    hop = config.hop_size
    n_signal = len(signal)

    if n_signal < size:
        raise ValueError(
            f"Signal length ({n_signal}) is shorter than window_size ({size}). "
            "Provide a longer signal or reduce window_size."
        )

    win = get_window(config.window_fn.value, size)

    # All valid frame start indices for the full signal.
    starts = np.arange(0, n_signal - size + 1, hop, dtype=np.intp)
    n_times = len(starts)

    # ── Pre-selection optimisation ───────────────────────────────────────────
    # When the natural frame count exceeds the display cap we will downsample
    # the time axis.  Rather than computing ALL frames and then discarding
    # most of them, we pre-select only the _MAX_SPECTROGRAM_BINS frames that
    # will appear in the output.  For a 10 M-sample signal with hop_size=1
    # this reduces work from ~10 million FFTs to exactly 2,000 — a 5000×
    # speedup before any other optimisation applies.
    downsampled = n_times > _MAX_SPECTROGRAM_BINS
    if downsampled:
        selected_idx = np.round(
            np.linspace(0, n_times - 1, _MAX_SPECTROGRAM_BINS)
        ).astype(np.intp)
        active_starts = starts[selected_idx]
    else:
        active_starts = starts

    sig_f64 = signal.astype(np.float64)

    # ── Vectorised frame matrix ──────────────────────────────────────────────
    # Build shape (n_active, window_size) frame matrix via advanced indexing.
    # Each row is one analysis frame; no Python loop required.
    frame_indices = (
        active_starts[:, np.newaxis] + np.arange(size, dtype=np.intp)[np.newaxis, :]
    )
    windowed = sig_f64[frame_indices] * win[np.newaxis, :]

    # ── Multi-threaded FFT ───────────────────────────────────────────────────
    # scipy.fft.rfft with workers=-1 dispatches pocketfft threads equal to
    # os.cpu_count(), saturating all available cores for transform sizes ≥ 32k.
    magnitudes = np.abs(
        _scipy_fft.rfft(windowed, axis=1, workers=-1)
    )  # shape: (n_active, n_freqs)

    freqs = _scipy_fft.rfftfreq(size, d=1.0 / sampling_rate_hz)
    time_bins = (active_starts + size // 2) / sampling_rate_hz

    # dBFS: normalise to peak magnitude across the entire output matrix.
    peak = magnitudes.max()
    if peak > 0:
        db_matrix = 20.0 * np.log10(magnitudes / peak + _EPSILON)
    else:
        db_matrix = np.full_like(magnitudes, 20.0 * np.log10(_EPSILON))

    return SpectrogramResult(
        time_bins_s=time_bins,
        frequency_bins_hz=freqs,
        magnitude_db=db_matrix,
        downsampled=downsampled,
    )
