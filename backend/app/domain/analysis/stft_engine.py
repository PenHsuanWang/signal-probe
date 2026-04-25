"""Pure STFT computation engine.

This module has ZERO framework imports (no FastAPI, SQLAlchemy, Polars).
It accepts plain NumPy arrays and domain value objects, and returns
dataclass results.  This satisfies Clean Architecture: the domain layer
depends only on standard scientific libraries (numpy, scipy).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.fft as npfft
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

    spectrum = npfft.rfft(windowed)
    freqs = npfft.rfftfreq(size, d=1.0 / sampling_rate_hz)
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
    n_freqs = size // 2 + 1

    # Pre-compute frame start indices.
    starts = np.arange(0, n_signal - size + 1, hop, dtype=np.intp)
    n_times = len(starts)

    spectrogram = np.zeros((n_times, n_freqs), dtype=np.float64)
    sig_f64 = signal.astype(np.float64)

    for i, s in enumerate(starts):
        frame = sig_f64[s : s + size] * win
        spectrogram[i] = np.abs(npfft.rfft(frame))

    freqs = npfft.rfftfreq(size, d=1.0 / sampling_rate_hz)
    # Centre of each frame in seconds.
    time_bins = (starts + size // 2) / sampling_rate_hz

    # dBFS: normalise to peak magnitude then convert to decibels.
    peak = spectrogram.max()
    if peak > 0:
        db_matrix = 20.0 * np.log10(spectrogram / peak + _EPSILON)
    else:
        db_matrix = np.full_like(spectrogram, 20.0 * np.log10(_EPSILON))

    # Uniform downsampling when the time axis exceeds the display cap.
    downsampled = n_times > _MAX_SPECTROGRAM_BINS
    if downsampled:
        idx = np.round(np.linspace(0, n_times - 1, _MAX_SPECTROGRAM_BINS)).astype(
            np.intp
        )
        db_matrix = db_matrix[idx]
        time_bins = time_bins[idx]

    return SpectrogramResult(
        time_bins_s=time_bins,
        frequency_bins_hz=freqs,
        magnitude_db=db_matrix,
        downsampled=downsampled,
    )
