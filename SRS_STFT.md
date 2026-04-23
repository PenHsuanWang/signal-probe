# Software Requirements Specification

**Product:** signal-probe
**Feature:** STFT Interactive Spectral Analysis
**Version:** 1.0
**Date:** 2026-04-23
**Status:** Draft

---

## 1. Product Overview

- **Product Name:** Signal Probe — Short-Time Fourier Transform (STFT) Interactive Spectral Analysis
- **Business Goal:** Enable process engineers and data scientists to investigate non-stationary frequency behaviour in industrial time-series signals. By sliding a configurable time window over an already-processed signal and recomputing the FFT for each position, analysts can pinpoint the onset and offset of resonant frequencies, identify harmonic distortion in equipment, and correlate spectral anomalies with known OOC events—without leaving the signal-probe interface.
- **Target Audience:** Data Scientists, Process Engineers, Equipment Engineers, Signal Processing Researchers.
- **Integration Context:** This feature extends the existing signal-probe platform (React 19 + FastAPI + Parquet storage). It becomes available on a processed signal once its status is `COMPLETED`, as a new **Analysis** tab on the signal detail page.

---

## 2. Epics & User Stories

---

### EPIC-STFT-1: Interactive STFT Window Analysis

**Description:** The core interactive experience—select a processed channel, drag a highlighted time window across the time-domain chart, and see the FFT frequency spectrum update in real time. The analyst can also configure the window function and window size to trade off time resolution against frequency resolution.

---

#### USER STORY-1.1: Load a Processed Channel for Spectral Analysis

- **User Story:** As a process engineer, I want to select a signal channel from a COMPLETED signal and open it in the STFT analysis view, so that I can begin exploring its frequency content.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: Channel loads successfully**
    - **Given** a signal with status `COMPLETED` and at least one channel
    - **And** the user navigates to the signal detail page
    - **When** the user clicks the **Analysis** tab
    - **Then** a channel selector is shown listing all available channels
    - **And** the first channel is auto-selected
    - **And** the time-domain signal trace is rendered with a default window positioned at the start of the signal
  - **Scenario 2 — Unhappy Path: Signal not yet processed**
    - **Given** a signal with status `PROCESSING` or `AWAITING_CONFIG`
    - **When** the user clicks the **Analysis** tab
    - **Then** an informational banner is shown: *"Analysis is available once processing completes."*
    - **And** no API calls are made to the STFT endpoint
  - **Scenario 3 — Unhappy Path: Signal failed**
    - **Given** a signal with status `FAILED`
    - **When** the user clicks the **Analysis** tab
    - **Then** an error state is shown: *"Signal processing failed — analysis is unavailable."*
- **Business Rules:**
  - Analysis tab is only enabled for signals in `COMPLETED` state.
  - Multi-channel signals display a channel selector; single-channel signals auto-select and hide the selector.

---

#### USER STORY-1.2: Drag a Time Window to Update the FFT Spectrum

- **User Story:** As a data scientist, I want to drag a highlighted rectangle window across the time-domain chart, so that the FFT spectrum updates automatically for the selected time segment and I can observe how frequency content evolves over time.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: Window drag triggers spectrum update**
    - **Given** a channel is loaded in the STFT analysis view
    - **And** the default window rectangle is visible on the time-domain chart
    - **When** the user drags the window rectangle to a new time range `[t_start, t_end]`
    - **Then** a `GET /signals/{id}/analysis/stft` request is issued with the new `start_s` and `end_s`
    - **And** the frequency spectrum chart updates within **500 ms** of the drag completing
    - **And** the dominant frequency is annotated on the spectrum with a vertical dashed line and label
  - **Scenario 2 — Happy Path: Window resize changes resolution**
    - **Given** the window is currently 1 s wide
    - **When** the user resizes the window to 4 s wide
    - **Then** the frequency resolution improves (bin spacing decreases)
    - **And** the spectrum re-renders with narrower peaks
  - **Scenario 3 — Unhappy Path: Window dragged beyond signal bounds**
    - **Given** a signal with total duration 120 s
    - **When** the user drags the window so that `t_end > 120`
    - **Then** the window is clamped server-side to `[t_start, 120]`
    - **And** the spectrum is computed for the clamped range
    - **And** a tooltip appears: *"Window clamped to signal boundary."*
  - **Scenario 4 — Unhappy Path: Window narrower than minimum**
    - **Given** the user attempts to shrink the window below 4 samples
    - **When** the window boundary update fires
    - **Then** the window snaps to a minimum of 4 samples
    - **And** a tooltip appears: *"Minimum window is 4 samples."*
  - **Scenario 5 — Unhappy Path: API error during FFT**
    - **Given** the STFT endpoint returns HTTP 5xx
    - **When** the spectrum request completes
    - **Then** an error banner appears: *"Spectrum computation failed. Please try again."*
    - **And** the previous spectrum remains visible (stale display)
- **Business Rules:**
  - Window size in samples = `floor((t_end - t_start) * sampling_rate_hz)`. Must be ≥ 4 and ≤ 131,072.
  - The `window_size` parameter for the FFT is separate from the time range: `window_size` specifies the FFT transform length, which may be zero-padded to the next power of 2 when `window_size` < number of samples in the range.

---

#### USER STORY-1.3: Configure Window Function

- **User Story:** As a signal processing researcher, I want to choose from all standard SciPy window functions, so that I can control spectral leakage and optimise frequency resolution for my analysis.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: Window function change**
    - **Given** the spectrum is displayed with the default Hann window
    - **When** the user selects "Blackman" from the window function dropdown
    - **Then** the STFT request is re-issued with `window_fn=blackman`
    - **And** the spectrum updates, showing the different sidelobe suppression characteristics
  - **Scenario 2 — Happy Path: Rectangular window (no tapering)**
    - **Given** the user selects "Boxcar (Rectangular)"
    - **When** the spectrum updates
    - **Then** a warning badge appears: *"Boxcar window may exhibit high spectral leakage."*
- **Business Rules:**
  - Default window function: `hann`.
  - Supported window functions are all names accepted by `scipy.signal.get_window`: `hann`, `hamming`, `blackman`, `bartlett`, `flattop`, `parzen`, `bohman`, `blackmanharris`, `nuttall`, `barthann`, `cosine`, `exponential`, `tukey`, `taylor`, `boxcar` (and any future additions to SciPy's registry).

---

#### USER STORY-1.4: Configure Window Transform Size

- **User Story:** As a data scientist, I want to adjust the FFT window size (number of samples in the transform), so that I can tune the trade-off between time resolution and frequency resolution.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: Window size change**
    - **Given** the current window size is 1024 samples
    - **When** the user moves the size slider to 4096
    - **Then** the STFT is recomputed with `window_size=4096`
    - **And** the frequency axis bins become 4× finer
  - **Scenario 2 — Display: Resolution advisory**
    - **Given** any window size is set
    - **Then** the UI shows `Freq. resolution: {sampling_rate / window_size:.3f} Hz/bin` beneath the slider
    - **And** `Time segments: {total_samples // window_size}` (number of non-overlapping windows)
- **Business Rules:**
  - Allowed values: powers of 2 from 4 to 131,072 (exposed via a stepped slider).
  - Default: 1024 samples.

---

### EPIC-STFT-2: Full Spectrogram (Waterfall) Visualization

**Description:** A scrollable heatmap showing the complete STFT across the entire signal—frequency on the y-axis, time on the x-axis, and power (dB) encoded as colour. A vertical cursor line is synchronized with the active STFT window position.

---

#### USER STORY-2.1: Compute and Display the Spectrogram Heatmap

- **User Story:** As a process engineer, I want to see a full spectrogram (waterfall plot) of my signal, so that I can visually identify time-varying frequency patterns and anomalies across the entire recording.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: Spectrogram renders**
    - **Given** a channel is loaded in the STFT analysis view
    - **When** the user clicks **Compute Spectrogram**
    - **Then** a loading spinner is shown while the backend computes the full-signal STFT
    - **And** the spectrogram heatmap renders within **5 s** for signals of ≤ 1 M samples
    - **And** the y-axis shows frequency (0 to Nyquist Hz), x-axis shows time (s), and colour encodes power (dBFS)
    - **And** a colour scale selector (Viridis, Plasma, Inferno, Greys) is available
  - **Scenario 2 — Unhappy Path: Signal too long (> 10 M samples)**
    - **Given** the signal exceeds 10 M samples
    - **When** the user clicks **Compute Spectrogram**
    - **Then** the backend automatically downsamples the spectrogram to a maximum of 2000 time bins before returning
    - **And** a notice appears: *"Spectrogram downsampled to 2000 time bins for display."*
  - **Scenario 3 — Unhappy Path: Computation timeout**
    - **Given** the backend spectrogram computation exceeds 30 s
    - **When** the timeout fires
    - **Then** an error banner appears: *"Spectrogram computation timed out. Try reducing window size or hop size."*
- **Business Rules:**
  - Hop size defaults to `window_size // 2` (50 % overlap). User may override via a separate slider.
  - Magnitude is converted to dBFS: `20 × log₁₀(|X[k]| / max(|X|) + ε)`.
  - Maximum response payload: 50 MB (configurable via `STFT_MAX_RESPONSE_MB` environment variable).

---

#### USER STORY-2.2: Synchronise STFT Window Cursor on the Spectrogram

- **User Story:** As a data scientist, I want a vertical cursor on the spectrogram to track my current STFT window position, so that I can correlate the FFT slice with the spectrogram context.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: Cursor follows window**
    - **Given** both the time-domain chart and spectrogram are displayed
    - **When** the user drags the STFT window to `[t_start, t_end]`
    - **Then** the vertical cursor on the spectrogram jumps to the centre time `(t_start + t_end) / 2`
    - **And** a shaded band spanning `[t_start, t_end]` is overlaid on the spectrogram
  - **Scenario 2 — Happy Path: Spectrogram click moves window**
    - **Given** the spectrogram is displayed
    - **When** the user clicks at time position `t_click` on the spectrogram
    - **Then** the STFT window on the time-domain chart re-centres at `t_click`
    - **And** the spectrum updates accordingly

---

### EPIC-STFT-3: Analysis Export

**Description:** Enable analysts to capture their findings as downloadable artefacts.

---

#### USER STORY-3.1: Export Current FFT Spectrum as CSV

- **User Story:** As a process engineer, I want to download the current FFT spectrum as a CSV file, so that I can perform further statistical analysis in my own tools.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: CSV downloaded**
    - **Given** a spectrum is displayed
    - **When** the user clicks **Export CSV**
    - **Then** the browser downloads a file named `stft_{signal_id}_{channel}_{start_s:.3f}_{end_s:.3f}.csv`
    - **And** the CSV contains columns: `frequency_hz`, `magnitude`, `magnitude_db`, `phase_rad`
  - **Scenario 2 — Unhappy Path: No spectrum yet**
    - **Given** no spectrum has been computed
    - **When** the user clicks **Export CSV**
    - **Then** the button is disabled and a tooltip says: *"Compute a spectrum first."*

---

#### USER STORY-3.2: Export Spectrogram as PNG

- **User Story:** As a data scientist, I want to export the spectrogram heatmap as a high-resolution PNG image, so that I can include it in reports and presentations.
- **Acceptance Criteria:**
  - **Scenario 1 — Happy Path: PNG downloaded**
    - **Given** the spectrogram is displayed
    - **When** the user clicks **Export PNG**
    - **Then** the browser downloads `spectrogram_{signal_id}_{channel}.png` at 2× pixel scale
  - **Scenario 2 — Unhappy Path: Spectrogram not yet computed**
    - **Given** the spectrogram has not been computed
    - **When** the user clicks **Export PNG**
    - **Then** the button is disabled and a tooltip says: *"Compute the spectrogram first."*

---

## 3. Non-Functional Requirements (NFRs)

| Category | Requirement |
|----------|-------------|
| **Performance — STFT endpoint** | `GET /analysis/stft` must respond within **200 ms** for window sizes ≤ 65,536 samples |
| **Performance — Spectrogram endpoint** | `GET /analysis/spectrogram` must complete within **5 s** for signals ≤ 1 M samples (excluding payload transmission) |
| **Performance — Frontend render** | Spectrum chart must render within **100 ms** of receiving the JSON response |
| **Data scale** | Must support signals up to **10 M samples**; Parquet is read as a single-channel lazy slice |
| **Numerical precision** | All FFT computation must use **float64** (double precision) throughout |
| **Payload size** | Spectrogram response must not exceed `STFT_MAX_RESPONSE_MB` (default 50 MB); automatic downsampling applied when threshold is exceeded |
| **Concurrency** | Multiple users may compute STFT/spectrogram on different signals simultaneously; no shared mutable state |
| **Code quality** | Backend: `ruff` clean, `mypy --strict` passing, ≥ 90 % test coverage on `domain/analysis/` |
| **Type safety** | All Python modules strictly typed (Python 3.12+); TypeScript `strict` mode |
| **Accessibility** | All interactive controls (dropdown, slider, button) pass **WCAG 2.1 AA** |
| **Backward compatibility** | The STFT feature is additive; no existing API endpoints or Pydantic schemas are modified |

---

## 4. Glossary & Definitions

| Term | Definition |
|------|-----------|
| **DFT (Discrete Fourier Transform)** | The mathematical transform that maps a finite discrete time-domain sequence to its frequency-domain representation: `X_k = Σ x_n · e^(−i2πkn/N)` |
| **FFT (Fast Fourier Transform)** | An efficient algorithm that computes the DFT in O(N log N) instead of O(N²). NumPy's `rfft` is used for real-valued input signals. |
| **STFT (Short-Time Fourier Transform)** | A sequence of FFTs, each applied to a short, possibly overlapping, windowed segment of the signal. Provides joint time-frequency information. |
| **Spectrogram** | A 2-D heatmap visualisation of the STFT magnitude across all time bins; axes are time (x) and frequency (y), colour encodes power (dB). |
| **Window Function** | A tapering function applied to each signal segment before the FFT to reduce spectral leakage by smoothing sharp edge discontinuities. Examples: Hann, Hamming, Blackman. |
| **Spectral Leakage** | Artefact caused by the implicit periodicity assumption of the DFT when applied to a finite-length signal segment with non-zero endpoints. Window functions mitigate this. |
| **Time-Frequency Resolution Trade-off** | Analogous to the Heisenberg Uncertainty Principle: a narrow window gives fine time resolution but coarse frequency resolution; a wide window gives fine frequency resolution but coarse time resolution. |
| **Nyquist Frequency** | The maximum representable frequency in a sampled signal = `sampling_rate_hz / 2`. Frequencies above Nyquist alias back into the spectrum. |
| **dBFS (decibels relative to full scale)** | `20 × log₁₀(|X| / max(|X|))`. Used to express spectrogram magnitude on a logarithmic scale. |
| **Hop Size** | The step (in samples) between successive analysis windows in the spectrogram. Hop size = `window_size / 2` gives 50 % overlap. |
| **Dominant Frequency** | The frequency bin with the largest magnitude in the FFT spectrum for the current window. |
| **Zero-Padding** | Appending zeros to the signal segment before the FFT to increase the number of frequency bins (interpolating the spectrum). Does not add information but improves visual resolution. |
| **Parquet** | The columnar storage format used for processed signal data in signal-probe. Each channel is a separate column for O(1) columnar reads. |
