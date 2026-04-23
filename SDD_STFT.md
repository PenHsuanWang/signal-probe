# Software Design Document

**Product:** signal-probe
**Feature:** STFT Interactive Spectral Analysis
**Version:** 1.0
**Date:** 2026-04-23
**Status:** Draft

---

## 1. Introduction & Scope

### 1.1 Purpose

This document defines the technical architecture and design for integrating Short-Time Fourier Transform (STFT) spectral analysis into signal-probe. The feature allows engineers to interactively slide a configurable time window across a processed signal and observe the evolving FFT frequency spectrum, together with a full scrollable spectrogram heatmap.

### 1.2 System Boundaries

**In scope:**
- New FastAPI router: `GET /api/v1/signals/{id}/analysis/stft` and `GET /api/v1/signals/{id}/analysis/spectrogram`
- New backend computation module: `app/domain/analysis/stft_engine.py`
- New application service: `app/application/analysis/stft_service.py`
- New Pydantic schemas: `app/domain/analysis/schemas.py`
- New React page: `frontend/src/pages/AnalysisPage.tsx`
- New React components: `STFTPanel`, `TimeSignalWithWindow`, `SpectrumChart`, `SpectrogramHeatmap`, `WindowConfigControls`
- New React hook: `frontend/src/hooks/useSTFT.ts`
- New TypeScript types: additions to `frontend/src/types/signal.ts`
- New backend test module: `backend/tests/test_stft_engine.py`

**Out of scope:**
- Real-time streaming STFT (WebSocket push)
- Cross-signal spectral comparison
- Automated anomaly detection from spectrum peaks
- Support for non-Parquet input formats in the STFT endpoint
- Phase spectrum display (magnitudes only for initial release)

### 1.3 Stakeholders

| Role | Responsibility |
|------|---------------|
| Process Engineer | Primary user; analyses equipment sensor signals |
| Data Scientist | Secondary user; investigates frequency anomalies |
| Backend Engineer | Implements FastAPI router + computation modules |
| Frontend Engineer | Implements React components + hook |

---

## 2. System Architecture (High-Level Design)

### 2.1 Integration Point

The STFT feature is additive: it attaches to signals already in `COMPLETED` state. The new **Analysis** tab appears alongside the existing Macro/Micro tabs on the signal detail page.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BROWSER (React 19 + Plotly)                     │
│                                                                     │
│  SignalDetailPage                                                   │
│  ├── [Macro tab]  MultiChannelMacroChart  (existing)               │
│  ├── [Micro tab]  MicroChart grid          (existing)               │
│  └── [Analysis tab] ──────────────────────────────────────────┐    │
│       STFTPanel                                                │    │
│       ├── WindowConfigControls  (fn dropdown + size slider)   │    │
│       ├── TimeSignalWithWindow  (Plotly scattergl + rectangle) │    │
│       ├── SpectrumChart         (Plotly bar/line, log scale)   │    │
│       └── SpectrogramHeatmap   (Plotly heatmap, colorscale)   │    │
│                                └──────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  REST (Axios, Bearer JWT)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  BACKEND (FastAPI + Python 3.12)                    │
│                                                                     │
│  PRESENTATION  /api/v1/signals/{id}/analysis/                      │
│       └── AnalysisRouter   (stft + spectrogram endpoints)          │
│                 │                                                   │
│  APPLICATION   STFTService                                          │
│                 │  reads processed Parquet (Polars lazy scan)       │
│                 │  validates channel + signal status                │
│                 ▼                                                   │
│  DOMAIN        STFTEngine (pure functions, zero framework imports) │
│                 │  compute_stft()  •  compute_spectrogram()        │
│                 │  NumPy rfft / rfftfreq                           │
│                 │  scipy.signal.get_window                         │
│                 ▼                                                   │
│  INFRASTRUCTURE  LocalStorageAdapter → reads .parquet file         │
└─────────────────────────────────────────────────────────────────────┘
                               │
                    Parquet (processed signal)
                    e.g. columns: timestamp_s, voltage, temperature
```

### 2.2 External Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| `numpy` | ≥ 1.26 | `rfft`, `rfftfreq`, array operations |
| `scipy` | ≥ 1.12 | `scipy.signal.get_window` for all standard window functions |
| `polars` | ≥ 0.20 | Lazy Parquet scan, single-column extraction |
| `plotly` (React) | existing | `scattergl`, `bar`, `heatmap` traces |

No new infrastructure (database tables, storage buckets, or message queues) is required.

---

## 3. Domain-Driven Design (DDD) Mapping

### 3.1 Bounded Context: Spectral Analysis

This is a new, self-contained Bounded Context. It reads from the existing `Signal` aggregate (via Parquet) but introduces no new SQL entities.

```
┌─── Bounded Context: Spectral Analysis ──────────────────────────────┐
│                                                                      │
│  Entities (read-only view)                                           │
│    SignalChannel  — identity: (signal_id, channel_name)             │
│                    attrs: timestamps_s[], amplitudes[], sr_hz        │
│                                                                      │
│  Value Objects (immutable)                                           │
│    STFTWindowConfig  — start_s, end_s, window_fn, window_size       │
│    SpectrogramConfig — window_fn, window_size, hop_size             │
│    SpectrumResult    — frequencies_hz[], magnitudes[], phases_rad[]  │
│                        dominant_frequency_hz, window_config          │
│    SpectrogramResult — time_bins_s[][], frequency_bins_hz[],        │
│                        magnitude_db[][] (time × freq matrix)        │
│                                                                      │
│  Domain Events                                                       │
│    WindowMoved(signal_id, channel_name, new_config)                 │
│    SpectrogramRequested(signal_id, channel_name, config)            │
│    ExportRequested(type: "csv" | "png", signal_id, channel_name)    │
│                                                                      │
│  Business Invariants                                                 │
│    • window_size ∈ {4, 8, 16, …, 131072}  (powers of 2)            │
│    • start_s < end_s                                                 │
│    • end_s ≤ max(timestamps_s)                                       │
│    • number_of_samples_in_window ≥ 4                                │
│    • hop_size ≥ 1 AND hop_size ≤ window_size                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 State Transitions

```
IDLE
  │  (channel selected)
  ▼
READY  ◄──────────────────────────────────────────────────┐
  │  (window moved / fn changed / size changed)           │
  ▼                                                       │
COMPUTING_STFT                                            │
  │  (200 OK)                                             │
  ▼                                                       │
SPECTRUM_READY ────────────────────────────────────────────┘
  │  (spectrogram requested)
  ▼
COMPUTING_SPECTROGRAM
  │  (200 OK)
  ▼
SPECTROGRAM_READY
```

Errors at `COMPUTING_STFT` → return to `SPECTRUM_READY` (stale) with error banner.
Errors at `COMPUTING_SPECTROGRAM` → return to `SPECTRUM_READY` with error banner.

---

## 4. Component Design (Low-Level Design)

### 4.1 Backend — Pydantic Schemas (`app/domain/analysis/schemas.py`)

```python
from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, Field


class WindowFunction(str, Enum):
    """All scipy.signal.get_window-compatible names."""
    hann          = "hann"
    hamming       = "hamming"
    blackman      = "blackman"
    bartlett      = "bartlett"
    flattop       = "flattop"
    parzen        = "parzen"
    bohman        = "bohman"
    blackmanharris = "blackmanharris"
    nuttall       = "nuttall"
    barthann      = "barthann"
    cosine        = "cosine"
    exponential   = "exponential"
    tukey         = "tukey"
    taylor        = "taylor"
    boxcar        = "boxcar"   # rectangular — no tapering


class STFTWindowConfig(BaseModel):
    start_s:     float          = Field(..., description="Window start (seconds from t=0)")
    end_s:       float          = Field(..., description="Window end (seconds from t=0)")
    window_fn:   WindowFunction = Field(WindowFunction.hann)
    window_size: int            = Field(1024, ge=4, le=131072,
                                        description="FFT transform length (samples, power of 2)")


class STFTResponse(BaseModel):
    signal_id:             str
    channel_name:          str
    frequencies_hz:        list[float]
    magnitudes:            list[float]
    dominant_frequency_hz: float | None
    window_config:         STFTWindowConfig
    sampling_rate_hz:      float


class SpectrogramConfig(BaseModel):
    window_fn:   WindowFunction = Field(WindowFunction.hann)
    window_size: int            = Field(1024, ge=4, le=131072)
    hop_size:    int            = Field(512,  ge=1)


class SpectrogramResponse(BaseModel):
    signal_id:          str
    channel_name:       str
    time_bins_s:        list[float]
    frequency_bins_hz:  list[float]
    magnitude_db:       list[list[float]]   # [n_time_bins × n_freq_bins]
    sampling_rate_hz:   float
    downsampled:        bool = False        # True when auto-downsampled to 2000 bins
```

### 4.2 Backend — Computation Engine (`app/domain/analysis/stft_engine.py`)

Pure Python + NumPy/SciPy module. Zero FastAPI or SQLAlchemy imports — preserves Clean Architecture.

```python
import numpy as np
import numpy.fft as npfft
from scipy.signal import get_window
from dataclasses import dataclass

_EPSILON = 1e-12          # prevent log(0) in dB conversion
_MAX_SPECTROGRAM_BINS = 2000  # time-bin cap before downsampling


@dataclass(frozen=True)
class _STFTResult:
    frequencies_hz:        np.ndarray   # shape (n_freq,)
    magnitudes:            np.ndarray   # shape (n_freq,)
    dominant_frequency_hz: float | None


def compute_stft(
    signal_segment: np.ndarray,
    sampling_rate_hz: float,
    config: "STFTWindowConfig",        # imported from schemas
) -> _STFTResult:
    """
    Apply a window function to ``signal_segment`` and compute the one-sided
    real FFT.  Zero-pads the segment to ``config.window_size`` if shorter.
    """
    n = len(signal_segment)
    if n < 4:
        raise ValueError(f"Segment too short: {n} samples (minimum 4)")

    # Pad or truncate to window_size
    size = config.window_size
    if n < size:
        segment = np.zeros(size, dtype=np.float64)
        segment[:n] = signal_segment
    else:
        segment = signal_segment[:size].astype(np.float64)

    win = get_window(config.window_fn.value, size)
    windowed = segment * win

    spectrum = npfft.rfft(windowed)
    freqs    = npfft.rfftfreq(size, d=1.0 / sampling_rate_hz)
    mags     = np.abs(spectrum)

    dominant = float(freqs[np.argmax(mags)]) if mags.max() > 0 else None
    return _STFTResult(
        frequencies_hz=freqs,
        magnitudes=mags,
        dominant_frequency_hz=dominant,
    )


def compute_spectrogram(
    signal: np.ndarray,
    sampling_rate_hz: float,
    config: "SpectrogramConfig",
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Returns (time_bins_s, frequency_bins_hz, magnitude_db_matrix).
    magnitude_db_matrix has shape (n_time_bins, n_freq_bins).
    Auto-downsamples the time axis to _MAX_SPECTROGRAM_BINS when needed.
    """
    size     = config.window_size
    hop      = config.hop_size
    win      = get_window(config.window_fn.value, size)
    n_signal = len(signal)

    starts  = np.arange(0, n_signal - size + 1, hop)
    n_times = len(starts)
    n_freqs = size // 2 + 1

    spectrogram = np.zeros((n_times, n_freqs), dtype=np.float64)
    for i, s in enumerate(starts):
        frame = signal[s : s + size].astype(np.float64) * win
        spectrogram[i] = np.abs(npfft.rfft(frame))

    freqs     = npfft.rfftfreq(size, d=1.0 / sampling_rate_hz)
    time_bins = (starts + size // 2) / sampling_rate_hz

    # dBFS conversion
    max_val  = spectrogram.max()
    db_matrix = 20.0 * np.log10(spectrogram / max_val + _EPSILON)

    # Downsample time axis if needed
    if n_times > _MAX_SPECTROGRAM_BINS:
        idx       = np.round(np.linspace(0, n_times - 1, _MAX_SPECTROGRAM_BINS)).astype(int)
        db_matrix = db_matrix[idx]
        time_bins = time_bins[idx]

    return time_bins, freqs, db_matrix
```

### 4.3 Backend — Application Service (`app/application/analysis/stft_service.py`)

Responsible for: signal status validation, Parquet columnar read, sample-rate inference, delegation to domain engine, response assembly.

**Key steps in `get_stft(signal_id, channel_name, config)`:**

1. Load `SignalMetadata` from repository; raise `NotFoundException` if not found.
2. Assert `status == COMPLETED`; raise `ConflictException("Signal not yet processed")` if not.
3. Assert `channel_name` is in `metadata.channel_names`; raise `NotFoundException` if not.
4. Read `timestamp_s` and `<channel_name>` columns from Parquet via Polars lazy scan (single-column read — minimal memory).
5. Infer `sampling_rate_hz` from median difference of `timestamp_s`.
6. Slice the signal array to `[start_s, end_s]` window.
7. Assert slice length ≥ 4; clamp `end_s` to signal end if out of bounds.
8. Call `stft_engine.compute_stft(slice, sampling_rate_hz, config)`.
9. Assemble and return `STFTResponse`.

**Key steps in `get_spectrogram(signal_id, channel_name, config)`:**

1–5. Same as above (status + channel validation, full signal read).
6. Call `stft_engine.compute_spectrogram(signal, sampling_rate_hz, config)`.
7. Flag `downsampled=True` in response if time-bin reduction occurred.
8. Assemble and return `SpectrogramResponse`.

### 4.4 Backend — API Router (`app/presentation/api/v1/endpoints/analysis.py`)

```
GET /api/v1/signals/{signal_id}/analysis/stft
    Query params: channel_name (str), start_s (float), end_s (float),
                  window_fn (WindowFunction, default "hann"),
                  window_size (int, default 1024)
    Auth: Bearer JWT
    200: STFTResponse
    404: signal or channel not found
    409: signal not COMPLETED
    422: validation error (window_size not power of 2, start_s >= end_s, etc.)

GET /api/v1/signals/{signal_id}/analysis/spectrogram
    Query params: channel_name (str), window_fn (WindowFunction, default "hann"),
                  window_size (int, default 1024), hop_size (int, default 512)
    Auth: Bearer JWT
    200: SpectrogramResponse
    404: signal or channel not found
    409: signal not COMPLETED
    422: validation error
    413: response exceeds STFT_MAX_RESPONSE_MB
```

Cross-cutting: the router inherits the existing `_global_exception_handler` envelope (`{"error": {"code": "…", "message": "…", "timestamp": "…"}}`).

### 4.5 Frontend — TypeScript Types (additions to `frontend/src/types/signal.ts`)

```typescript
// ── STFT Analysis ──────────────────────────────────────────────────

export type WindowFunction =
  | 'hann' | 'hamming' | 'blackman' | 'bartlett' | 'flattop'
  | 'parzen' | 'bohman' | 'blackmanharris' | 'nuttall' | 'barthann'
  | 'cosine' | 'exponential' | 'tukey' | 'taylor' | 'boxcar';

export interface STFTWindowConfig {
  start_s:     number;
  end_s:       number;
  window_fn:   WindowFunction;
  window_size: number;
}

export interface STFTResponse {
  signal_id:             string;
  channel_name:          string;
  frequencies_hz:        number[];
  magnitudes:            number[];
  dominant_frequency_hz: number | null;
  window_config:         STFTWindowConfig;
  sampling_rate_hz:      number;
}

export interface SpectrogramResponse {
  signal_id:         string;
  channel_name:      string;
  time_bins_s:       number[];
  frequency_bins_hz: number[];
  magnitude_db:      number[][];   // [time × freq]
  sampling_rate_hz:  number;
  downsampled:       boolean;
}
```

### 4.6 Frontend — Hook: `useSTFT` (`frontend/src/hooks/useSTFT.ts`)

Uses `useReducer` consistent with the existing `useColumnConfig` pattern.

**State shape:**

```typescript
interface STFTState {
  status:         'idle' | 'ready' | 'computing_stft' | 'spectrum_ready'
                | 'computing_spectrogram' | 'spectrogram_ready' | 'error';
  channelName:    string | null;
  windowConfig:   STFTWindowConfig;
  spectrum:       STFTResponse | null;
  spectrogram:    SpectrogramResponse | null;
  stftError:      string | null;
  spectrogramError: string | null;
}
```

**Actions:**

| Action | Payload | Description |
|--------|---------|-------------|
| `SELECT_CHANNEL` | `string` | Sets channel, resets spectrum/spectrogram |
| `SET_WINDOW` | `Partial<STFTWindowConfig>` | Updates window bounds or config; triggers STFT request |
| `STFT_REQUEST` | — | Marks computing state |
| `STFT_SUCCESS` | `STFTResponse` | Stores result, transitions to `spectrum_ready` |
| `STFT_ERROR` | `string` | Stores error, stays at last spectrum (stale) |
| `SPECTROGRAM_REQUEST` | — | Marks computing spectrogram |
| `SPECTROGRAM_SUCCESS` | `SpectrogramResponse` | Stores heatmap |
| `SPECTROGRAM_ERROR` | `string` | Stores error |

**Debounce:** `SET_WINDOW` debounces API calls by **150 ms** to avoid request flooding during drag.

**Return (exposed to components):**

```typescript
export interface UseSTFTReturn {
  status:            STFTState['status'];
  channelName:       string | null;
  windowConfig:      STFTWindowConfig;
  spectrum:          STFTResponse | null;
  spectrogram:       SpectrogramResponse | null;
  stftError:         string | null;
  spectrogramError:  string | null;
  selectChannel:     (name: string) => void;
  setWindow:         (config: Partial<STFTWindowConfig>) => void;
  requestSpectrogram: () => void;
}
```

### 4.7 Frontend — Component Tree

```
AnalysisPage  (src/pages/AnalysisPage.tsx)
│  Reads: signalId (URL param), channelNames (from MacroViewResponse cache)
│  Owns:  useSTFT hook
│
└── STFTPanel  (src/components/STFTPanel.tsx)
      │
      ├── ChannelSelector  (inline dropdown — reuses existing pattern)
      │
      ├── WindowConfigControls  (src/components/WindowConfigControls.tsx)
      │     window_fn  — <select> dropdown of all WindowFunction values
      │     window_size — stepped <input type="range"> (powers of 2, 4→131072)
      │     Display: "Freq. resolution: X.XXX Hz/bin"
      │     Display: "Window: X.XXX s"
      │
      ├── TimeSignalWithWindow  (src/components/TimeSignalWithWindow.tsx)
      │     Plotly scattergl trace (full signal, thin line)
      │     Editable rectangle shape: x0=start_s, x1=end_s
      │     onRelayout → setWindow({ start_s, end_s })
      │
      ├── SpectrumChart  (src/components/SpectrumChart.tsx)
      │     Plotly bar trace (frequencies_hz × magnitudes)
      │     Log-scale toggle on y-axis
      │     Vertical dashed line at dominant_frequency_hz
      │     Export CSV button
      │
      └── SpectrogramHeatmap  (src/components/SpectrogramHeatmap.tsx)
            Plotly heatmap (time_bins_s × frequency_bins_hz × magnitude_db)
            Colorscale selector: Viridis / Plasma / Inferno / Greys
            Vertical cursor line at window centre
            Shaded band spanning [start_s, end_s]
            Click handler → setWindow (re-centres window)
            Export PNG button (Plotly toImage, scale=2)
            "Compute Spectrogram" button (lazy — user-initiated)
            Downsampled notice badge
```

---

## 5. Data Design

### 5.1 Parquet Input Schema (existing, read-only)

| Column | Type | Notes |
|--------|------|-------|
| `timestamp_s` | `Float64` | Elapsed seconds from signal start |
| `t0_epoch_s` | `Float64` (const) | Optional; absolute epoch of first sample |
| `<channel_name>` | `Float64` | Signal amplitude values |
| `<channel_name>_state` | `Utf8` | `IDLE` / `ACTIVE` / `OOC` — not used by STFT |
| `__unit_<channel_name>` | `Utf8` (const) | Physical unit string — not used by STFT |

The STFT service reads only `timestamp_s` and `<channel_name>` via a Polars lazy scan, minimising memory consumption.

### 5.2 Sampling Rate Inference

```python
# From a lazy Polars scan to avoid loading all rows:
ts = pl.scan_parquet(path).select("timestamp_s").collect()["timestamp_s"].to_numpy()
diffs = np.diff(ts)
sampling_rate_hz = 1.0 / float(np.median(diffs))
```

Non-uniform sampling is handled by resampling to the median rate before FFT (out of scope for v1.0 — documented as a known limitation).

### 5.3 Response Data Flow

```
Parquet (on disk)
  │  Polars lazy columnar read (timestamp_s + channel)
  ▼
numpy array (float64, shape N)
  │  Slice to [start_s, end_s]
  ▼
windowed segment (float64, shape window_size)
  │  scipy.signal.get_window → multiply
  ▼
rfft output (complex128, shape window_size//2 + 1)
  │  np.abs → magnitudes
  │  np.angle → phases (not included in v1.0 response)
  ▼
STFTResponse JSON (magnitudes serialised as list[float])
  │  Axios → React state
  ▼
Plotly bar trace (browser, ~100 ms render)
```

---

## 6. UI & Interaction Design

### 6.1 Key User Journey

```
1. User opens signal detail page for a COMPLETED signal
2. Clicks "Analysis" tab
3. (If multi-channel) Selects channel from dropdown
   → Full signal trace loads in TimeSignalWithWindow chart
   → Default window (1024 samples at t=0) positioned; STFT request fires
   → SpectrumChart shows initial FFT result
4. User drags window rectangle to anomalous region
   → Debounced STFT request fires after 150 ms
   → SpectrumChart updates; dominant frequency annotated
5. User changes window function to "Blackman"
   → STFT re-fires with new window_fn
6. User clicks "Compute Spectrogram"
   → Loading spinner 3-5 s
   → SpectrogramHeatmap renders; cursor syncs with current window
7. User clicks on spectrogram at t=47 s
   → TimeSignalWithWindow window re-centres at t=47 s
   → STFT re-fires; SpectrumChart updates
8. User clicks "Export CSV" on SpectrumChart → download
9. User clicks "Export PNG" on SpectrogramHeatmap → download
```

### 6.2 TimeSignalWithWindow — Plotly Configuration

```typescript
layout = {
  shapes: [{
    type: 'rect',
    xref: 'x',  yref: 'paper',
    x0: windowConfig.start_s,
    x1: windowConfig.end_s,
    y0: 0, y1: 1,
    fillcolor: 'rgba(59,130,246,0.15)',
    line: { color: 'rgba(59,130,246,0.8)', width: 1.5 },
    editable: true,     // ← enables Plotly's native drag handles
    layer: 'above',
  }],
  dragmode: 'select',
};
config = { editable: true };
onRelayout = (e) => {
  // Plotly emits 'shapes[0].x0' and 'shapes[0].x1' keys
  if ('shapes[0].x0' in e) {
    setWindow({ start_s: e['shapes[0].x0'], end_s: e['shapes[0].x1'] });
  }
};
```

### 6.3 SpectrumChart — Log Scale Toggle

The y-axis can be toggled between linear and `log` type via a small button beside the chart. Default: linear. Log scale is useful for identifying low-energy harmonics hidden near the noise floor.

### 6.4 CSS Token Conventions

All new components follow existing `--sp-*` token conventions. No new design tokens are introduced.

---

## 7. Technical Specifications & Non-Functional Requirements

### 7.1 Performance Budget

| Operation | Target | Measurement Point |
|-----------|--------|-----------------|
| `GET /analysis/stft` (window ≤ 65,536 samples) | < 200 ms | Server response time |
| `GET /analysis/spectrogram` (signal ≤ 1 M samples) | < 5 s | Server response time |
| Frontend spectrum chart render | < 100 ms | Plotly `afterplot` event |
| Debounce delay on window drag | 150 ms | `useSTFT` hook |

### 7.2 Numerical Correctness

- FFT input: `float64` (upcasted from `float32` Parquet if needed).
- `rfft` produces the one-sided spectrum (DC to Nyquist); negative frequencies are omitted.
- `rfftfreq` produces N/2+1 frequency bins from 0 to `sampling_rate_hz / 2`.
- Window functions are applied **before** zero-padding to avoid artefacts.

### 7.3 Security

- All endpoints require `Authorization: Bearer <JWT>` — reuses existing `get_current_user` dependency.
- Only the owner of a signal may request its STFT (ownership check at service layer).
- Query parameters are validated by Pydantic before any file I/O is performed.

### 7.4 Scalability

- No new SQL tables or rows are written; the feature is purely read-path.
- Parquet reads use Polars lazy scan (predicate pushdown where possible) to minimise I/O.
- Large spectrogram responses are gzip-compressed at the FastAPI layer.
- For very large signals (> 10 M samples), spectrogram computation runs in a `BackgroundTask` with a progress token (post-v1.0 enhancement).

### 7.5 Testing Strategy

| Layer | Approach | Target Coverage |
|-------|---------|----------------|
| `domain/analysis/stft_engine.py` | Pure unit tests (pytest); parametric over all `WindowFunction` values | ≥ 90 % |
| `application/analysis/stft_service.py` | Integration tests with synthetic Parquet fixtures | ≥ 80 % |
| `presentation/.../analysis.py` | Endpoint tests via `httpx.AsyncClient` | ≥ 80 % |
| `useSTFT.ts` hook | Vitest unit tests mocking Axios | ≥ 80 % |

Test file: `backend/tests/test_stft_engine.py`

---

## 8. Architecture Decision Records

### ADR-STFT-001 — FFT Library: NumPy `rfft` over SciPy `fft`

- **Decision:** Use `numpy.fft.rfft` as the primary FFT implementation. Use `scipy.signal.get_window` for window generation only.
- **Rationale:** `rfft` exploits the real-valued input to halve computation and memory (N/2+1 output bins vs. N). SciPy's `fftpack.rfft` uses a different output convention; NumPy's is more widely known and directly compatible with `rfftfreq`. SciPy is retained for its comprehensive `get_window` registry.

### ADR-STFT-002 — Spectrogram is User-Initiated (Not Auto-Computed)

- **Decision:** The spectrogram heatmap is computed on demand when the user clicks "Compute Spectrogram", not automatically on channel load.
- **Rationale:** Full-signal spectrogram computation is expensive (up to 5 s). Auto-computing it on every channel change would create a poor UX and unnecessary server load. The interactive STFT slice is cheap (< 200 ms) and loads automatically; the spectrogram is an opt-in deep-dive.

### ADR-STFT-003 — Debounce Window Drag at 150 ms

- **Decision:** The `useSTFT` hook debounces `SET_WINDOW` actions by 150 ms before issuing an API request.
- **Rationale:** Plotly fires `relayoutData` events continuously during a drag gesture. Without debouncing, a 1-second drag at 60 fps would issue ~60 API requests. 150 ms provides a smooth interactive feel while keeping server load manageable.

### ADR-STFT-004 — Spectrogram Downsampling to 2000 Time Bins

- **Decision:** When the full-signal spectrogram would produce > 2000 time bins, the engine automatically reduces to 2000 bins by uniform downsampling. A `downsampled: true` flag is returned.
- **Rationale:** The Plotly heatmap's visual resolution saturates well below 2000 columns on a standard 1920 px screen. Returning more bins increases JSON payload size without improving the display. The analyst is informed via a UI notice.

### ADR-STFT-005 — Phase Not Included in v1.0 Response

- **Decision:** `STFTResponse` includes `magnitudes` only, not `phases_rad`.
- **Rationale:** Phase spectrum is rarely actionable for industrial anomaly analysis and doubles the JSON payload. Phase can be added as an optional query parameter (`include_phase=true`) in a future iteration.
