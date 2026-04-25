"""Unit tests for the STFT computation engine.

Covers:
- compute_stft: correct output shape (N/2+1 frequency bins)
- compute_stft: dominant frequency detection on a pure sine wave
- compute_stft: zero-padding when segment < window_size
- compute_stft: truncation when segment > window_size
- compute_stft: all WindowFunction values execute without error
- compute_stft: ValueError on segment shorter than 4 samples
- compute_spectrogram: correct time and frequency bin dimensions
- compute_spectrogram: downsampling flag set when bins > 2000
- compute_spectrogram: no downsampling for short signals
- compute_spectrogram: ValueError when signal shorter than window_size
- compute_spectrogram: hop_size boundary (hop_size == window_size)
- _infer_sampling_rate: correct Hz from uniform timestamps
- _infer_sampling_rate: ValueError on single-sample input
- SpectrogramConfig: model_validator rejects hop_size > window_size
- STFTWindowConfig: model_validator rejects start_s >= end_s
- STFTWindowConfig: model_validator rejects non-power-of-2 window_size
"""

import numpy as np
import pytest

from app.application.analysis.stft_service import _infer_sampling_rate
from app.domain.analysis.schemas import (
    SpectrogramConfig,
    STFTWindowConfig,
    WindowFunction,
)
from app.domain.analysis.stft_engine import compute_spectrogram, compute_stft

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_sine(
    freq_hz: float,
    duration_s: float,
    sampling_rate_hz: float,
    amplitude: float = 1.0,
) -> np.ndarray:
    """Generate a pure single-frequency sine wave."""
    t = np.arange(0, duration_s, 1.0 / sampling_rate_hz)
    return amplitude * np.sin(2 * np.pi * freq_hz * t)


def _default_stft_config(**overrides) -> STFTWindowConfig:
    defaults = dict(
        start_s=0.0, end_s=1.0, window_fn=WindowFunction.hann, window_size=256
    )
    defaults.update(overrides)
    return STFTWindowConfig(**defaults)


def _default_spec_config(**overrides) -> SpectrogramConfig:
    defaults = dict(window_fn=WindowFunction.hann, window_size=256, hop_size=128)
    defaults.update(overrides)
    return SpectrogramConfig(**defaults)


# ── compute_stft ─────────────────────────────────────────────────────────────


class TestComputeStft:
    def test_output_shape(self):
        """rfft of a window_size=256 signal → 129 frequency bins (N/2+1)."""
        signal = np.random.default_rng(0).standard_normal(256)
        config = _default_stft_config(window_size=256)
        result = compute_stft(signal, sampling_rate_hz=1000.0, config=config)
        assert len(result.frequencies_hz) == 256 // 2 + 1
        assert len(result.magnitudes) == 256 // 2 + 1

    def test_dominant_frequency_pure_sine(self):
        """A 50 Hz sine at 1 kHz sampling → dominant ≈ 50 Hz."""
        sr = 1000.0
        signal = _make_sine(50.0, duration_s=1.0, sampling_rate_hz=sr)
        config = _default_stft_config(window_size=1024)
        result = compute_stft(signal, sampling_rate_hz=sr, config=config)
        assert result.dominant_frequency_hz is not None
        assert abs(result.dominant_frequency_hz - 50.0) < 5.0  # within ±5 Hz

    def test_zero_padding_short_segment(self):
        """Segment shorter than window_size is zero-padded; output shape unchanged."""
        sr = 500.0
        short = np.ones(64)
        config = _default_stft_config(window_size=256)
        result = compute_stft(short, sampling_rate_hz=sr, config=config)
        assert len(result.frequencies_hz) == 256 // 2 + 1

    def test_truncation_long_segment(self):
        """Segment longer than window_size is truncated to window_size."""
        sr = 500.0
        long_seg = np.ones(2048)
        config = _default_stft_config(window_size=256)
        result = compute_stft(long_seg, sampling_rate_hz=sr, config=config)
        assert len(result.magnitudes) == 256 // 2 + 1

    def test_magnitudes_non_negative(self):
        """All magnitude values must be ≥ 0 (|complex| is always non-negative)."""
        signal = np.random.default_rng(42).standard_normal(512)
        config = _default_stft_config(window_size=512)
        result = compute_stft(signal, sampling_rate_hz=2000.0, config=config)
        assert np.all(result.magnitudes >= 0)

    def test_frequencies_monotone(self):
        """Frequency bins must be strictly increasing from 0 to Nyquist."""
        signal = np.ones(256)
        config = _default_stft_config(window_size=256)
        result = compute_stft(signal, sampling_rate_hz=1000.0, config=config)
        assert result.frequencies_hz[0] == pytest.approx(0.0)
        assert result.frequencies_hz[-1] == pytest.approx(500.0)  # Nyquist = sr/2
        assert np.all(np.diff(result.frequencies_hz) > 0)

    def test_too_short_raises(self):
        """Segments with < 4 samples must raise ValueError."""
        with pytest.raises(ValueError, match="too short"):
            compute_stft(
                np.array([1.0, 2.0]),
                sampling_rate_hz=100.0,
                config=_default_stft_config(window_size=4),
            )

    @pytest.mark.parametrize("fn", list(WindowFunction))
    def test_all_window_functions(self, fn: WindowFunction):
        """Every WindowFunction value must execute without error."""
        signal = _make_sine(10.0, duration_s=0.5, sampling_rate_hz=200.0)
        config = _default_stft_config(window_size=64, window_fn=fn)
        result = compute_stft(signal, sampling_rate_hz=200.0, config=config)
        assert len(result.magnitudes) == 64 // 2 + 1

    def test_silent_signal_dominant_is_none(self):
        """A zero-amplitude signal has no meaningful dominant frequency."""
        signal = np.zeros(256)
        config = _default_stft_config(window_size=256)
        result = compute_stft(signal, sampling_rate_hz=1000.0, config=config)
        assert result.dominant_frequency_hz is None


# ── compute_spectrogram ───────────────────────────────────────────────────────


class TestComputeSpectrogram:
    def test_output_dimensions(self):
        """Spectrogram matrix has (n_time_bins, n_freq_bins) shape."""
        sr = 500.0
        signal = np.random.default_rng(7).standard_normal(2048)
        config = _default_spec_config(window_size=256, hop_size=128)
        result = compute_spectrogram(signal, sr, config)
        expected_n_time = (len(signal) - 256) // 128 + 1
        assert result.magnitude_db.shape == (expected_n_time, 256 // 2 + 1)
        assert len(result.time_bins_s) == expected_n_time
        assert len(result.frequency_bins_hz) == 256 // 2 + 1

    def test_no_downsampling_short_signal(self):
        """Signals producing ≤ 2000 time bins must not be downsampled."""
        sr = 1000.0
        # window=256, hop=128 → max 2000 bins ≈ 256,000 samples; use 10,000
        signal = np.random.default_rng(0).standard_normal(10_000)
        config = _default_spec_config(window_size=256, hop_size=128)
        result = compute_spectrogram(signal, sr, config)
        assert result.downsampled is False

    def test_downsampling_large_signal(self):
        """Signals producing > 2000 time bins trigger downsampling."""
        sr = 1000.0
        # window=256, hop=1 → n_time ≈ 10_000 > 2000
        signal = np.random.default_rng(0).standard_normal(10_256)
        config = _default_spec_config(window_size=256, hop_size=1)
        result = compute_spectrogram(signal, sr, config)
        assert result.downsampled is True
        assert len(result.time_bins_s) == 2000
        assert result.magnitude_db.shape[0] == 2000

    def test_dbfs_values_le_zero(self):
        """All dBFS values must be ≤ 0 (peak is always 0 dB by definition)."""
        signal = _make_sine(100.0, duration_s=2.0, sampling_rate_hz=1000.0)
        config = _default_spec_config(window_size=256, hop_size=128)
        result = compute_spectrogram(signal, 1000.0, config)
        assert np.all(result.magnitude_db <= 0.0 + 1e-6)  # tiny float tolerance

    def test_signal_shorter_than_window_raises(self):
        """Signal shorter than window_size must raise ValueError."""
        with pytest.raises(ValueError, match="shorter than window_size"):
            compute_spectrogram(
                np.ones(100), 1000.0, _default_spec_config(window_size=256)
            )

    def test_hop_equals_window_no_overlap(self):
        """hop_size == window_size (no overlap) is valid and produces correct bins."""
        sr = 1000.0
        signal = np.random.default_rng(1).standard_normal(2048)
        config = _default_spec_config(window_size=256, hop_size=256)
        result = compute_spectrogram(signal, sr, config)
        expected_n_time = (2048 - 256) // 256 + 1
        assert result.magnitude_db.shape[0] == expected_n_time

    def test_frequency_nyquist(self):
        """Last frequency bin must equal the Nyquist frequency (sr / 2)."""
        sr = 2000.0
        signal = np.random.default_rng(3).standard_normal(2048)
        config = _default_spec_config(window_size=512, hop_size=256)
        result = compute_spectrogram(signal, sr, config)
        assert result.frequency_bins_hz[-1] == pytest.approx(sr / 2, rel=1e-4)


# ── _infer_sampling_rate ──────────────────────────────────────────────────────


class TestInferSamplingRate:
    def test_uniform_timestamps(self):
        """Uniform 1 kHz timestamps → 1000 Hz."""
        ts = np.arange(0, 1.0, 1.0 / 1000.0)
        assert _infer_sampling_rate(ts) == pytest.approx(1000.0, rel=1e-3)

    def test_single_sample_raises(self):
        """Single timestamp cannot produce a sampling rate."""
        with pytest.raises(ValueError, match="at least 2"):
            _infer_sampling_rate(np.array([0.0]))

    def test_robust_to_gaps(self):
        """A few large gaps don't fool the median-based estimator."""
        ts = np.arange(0, 0.5, 1.0 / 100.0)  # 100 Hz for 50 samples
        # Inject 3 doubled gaps at random positions.
        rng = np.random.default_rng(9)
        gap_idx = rng.choice(len(ts) - 1, size=3, replace=False)
        ts_perturbed = ts.copy()
        for idx in gap_idx:
            ts_perturbed[idx + 1 :] += 1.0 / 100.0  # shift remaining by one extra dt
        assert _infer_sampling_rate(ts_perturbed) == pytest.approx(100.0, rel=0.05)


# ── Schema validators ─────────────────────────────────────────────────────────


class TestSchemaValidators:
    def test_stft_config_start_ge_end_raises(self):
        with pytest.raises(ValueError, match="start_s"):
            STFTWindowConfig(start_s=5.0, end_s=5.0, window_size=256)

    def test_stft_config_non_power_of_two_raises(self):
        with pytest.raises(ValueError, match="power of 2"):
            STFTWindowConfig(start_s=0.0, end_s=1.0, window_size=300)

    def test_stft_config_valid(self):
        cfg = STFTWindowConfig(start_s=0.0, end_s=1.0, window_size=512)
        assert cfg.window_size == 512

    def test_spectrogram_config_hop_gt_window_raises(self):
        with pytest.raises(ValueError, match="hop_size"):
            SpectrogramConfig(window_size=256, hop_size=512)

    def test_spectrogram_config_non_power_of_two_raises(self):
        with pytest.raises(ValueError, match="power of 2"):
            SpectrogramConfig(window_size=300, hop_size=128)

    def test_spectrogram_config_valid(self):
        cfg = SpectrogramConfig(window_size=1024, hop_size=512)
        assert cfg.hop_size == 512

    @pytest.mark.parametrize(
        "size",
        [
            4,
            8,
            16,
            32,
            64,
            128,
            256,
            512,
            1024,
            2048,
            4096,
            8192,
            16384,
            32768,
            65536,
            131072,
        ],
    )
    def test_all_valid_power_of_two_window_sizes(self, size: int):
        cfg = STFTWindowConfig(start_s=0.0, end_s=1.0, window_size=size)
        assert cfg.window_size == size

    def test_window_function_str_coercion(self):
        """WindowFunction accepts lowercase string values (StrEnum)."""
        cfg = STFTWindowConfig(
            start_s=0.0, end_s=1.0, window_fn="hamming", window_size=128
        )
        assert cfg.window_fn == WindowFunction.hamming


# ── Numerical accuracy spot-check ─────────────────────────────────────────────


class TestNumericalAccuracy:
    def test_dc_component(self):
        """A constant signal has all energy at 0 Hz (DC)."""
        signal = np.ones(512)
        config = _default_stft_config(window_size=512)
        result = compute_stft(signal, sampling_rate_hz=1000.0, config=config)
        assert int(np.argmax(result.magnitudes)) == 0

    def test_nyquist_component(self):
        """Alternating +1/-1 is pure Nyquist frequency."""
        sr = 1000.0
        signal = np.tile([1.0, -1.0], 256)  # 512 samples
        config = STFTWindowConfig(
            start_s=0.0, end_s=0.512, window_fn=WindowFunction.boxcar, window_size=512
        )
        result = compute_stft(signal, sampling_rate_hz=sr, config=config)
        nyquist_bin = len(result.frequencies_hz) - 1
        assert int(np.argmax(result.magnitudes)) == nyquist_bin

    def test_spectrogram_time_axis_start(self):
        """First time bin centre must equal window_size / (2 * sr)."""
        sr = 1000.0
        signal = np.random.default_rng(5).standard_normal(4096)
        config = _default_spec_config(window_size=256, hop_size=128)
        result = compute_spectrogram(signal, sr, config)
        expected_first = (256 / 2) / sr  # 0.128 s
        assert result.time_bins_s[0] == pytest.approx(expected_first, rel=1e-6)

    def test_stft_linearity(self):
        """Scaling the signal by k scales all magnitudes by k."""
        signal = _make_sine(20.0, duration_s=0.5, sampling_rate_hz=200.0)
        config = _default_stft_config(window_size=64)
        r1 = compute_stft(signal, 200.0, config)
        r2 = compute_stft(signal * 3.0, 200.0, config)
        np.testing.assert_allclose(r2.magnitudes, r1.magnitudes * 3.0, rtol=1e-6)

    def test_stft_pure_sine_spectrum_peak_position(self):
        """For a 100 Hz tone at 2 kHz, dominant bin should land on 100 Hz ± 1 bin."""
        sr = 2000.0
        freq = 100.0
        signal = _make_sine(freq, duration_s=1.0, sampling_rate_hz=sr)
        config = _default_stft_config(window_size=1024)
        result = compute_stft(signal, sr, config)
        freq_resolution = sr / 1024  # ≈ 1.95 Hz/bin
        assert abs(result.dominant_frequency_hz - freq) <= freq_resolution + 1e-6
