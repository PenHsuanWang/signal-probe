# Software Requirements Specification

**Product:** signal-probe
**Feature:** Interactive STFT Parameter Exploration & Spectrogram Generation
**Version:** 1.0
**Date:** 2026-04-25
**Status:** Draft

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Epics & User Stories](#2-epics--user-stories)
   - [EPIC-1: Interactive Time Window Exploration](#epic-1-interactive-time-window-exploration)
     - [USER STORY-1.1: Brush-based Time Window Selection](#user-story-11-brush-based-time-window-selection)
     - [USER STORY-1.2: Real-time FFT Spectrum Panel](#user-story-12-real-time-fft-spectrum-panel)
   - [EPIC-2: STFT Parameter Lock & Global Spectrogram](#epic-2-stft-parameter-lock--global-spectrogram)
     - [USER STORY-2.1: Window Size Lock-In](#user-story-21-window-size-lock-in)
     - [USER STORY-2.2: Overlap Ratio Configuration](#user-story-22-overlap-ratio-configuration)
     - [USER STORY-2.3: Full-Signal Spectrogram Generation & Heatmap Rendering](#user-story-23-full-signal-spectrogram-generation--heatmap-rendering)
     - [USER STORY-2.4: Spectrogram–Time-Series X-Axis Alignment](#user-story-24-spectrogramtime-series-x-axis-alignment)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [Out-of-Scope](#4-out-of-scope)
5. [Glossary & Definitions](#5-glossary--definitions)

---

## 1. Product Overview

- **Product Name:** signal-probe
- **Business Goal:** Data scientists analyzing non-stationary signals rely on the Short-Time Fourier Transform (STFT) to observe energy distribution across time and frequency. The current workflow forces analysts to manually guess STFT parameters (particularly window size), wait for full spectrogram recomputation, then visually inspect the result — repeating this loop until features become resolvable. This feature closes that loop by introducing an **interactive exploration phase**: the analyst brushes a region of interest on the macro time-series chart, receives instant FFT feedback as the window is resized, locks the validated window size, sets the overlap ratio, and triggers a single confirmed spectrogram generation — eliminating the blind trial-and-error cycle.
- **Target Audience:** Data scientists and signal-quality analysts who have already uploaded and processed a CSV signal file and need to determine STFT parameters visually before committing to a full spectrogram computation.

---

## 2. Epics & User Stories

### EPIC-1: Interactive Time Window Exploration

**Description:** Enable analysts to define an exploration window on the macro time-series chart using a brush/box selection tool. The system immediately computes and renders the FFT magnitude spectrum of that segment in an adjacent panel. As the user pans or resizes the window the spectrum updates in real-time (subject to a 300 ms debounce), providing continuous visual feedback on how window size impacts frequency resolution. This replaces manual parameter guessing with an eyes-on, hands-on exploration loop.

**Pre-condition:** The signal must be in `COMPLETED` processing status (i.e., a processed Parquet file exists). The exploration view is accessible from the signal detail page only for completed signals.

---

#### USER STORY-1.1: Brush-based Time Window Selection

- **User Story:** As a data scientist viewing a completed signal's macro chart, I want to drag a brush/box selection tool over the time-series to define an exploration window, so that I can isolate a specific segment of interest for FFT analysis without leaving the page.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Happy path: brush drag captures window**
    - **Given** a completed signal's time-series chart is displayed in the exploration view
    - **When** the user drags a brush over a time range `[t1, t2]`
    - **Then** the exploration window is captured as `start_s = t1`, `end_s = t2`
    - **And** the window duration in seconds and estimated sample count are shown beneath the chart
    - **And** the FFT Spectrum panel enters loading state and dispatches a debounced API call

  - **Scenario 2 — Window too short for FFT (< 4 samples)**
    - **Given** the user has brushed a very narrow time range
    - **When** the resulting sample count in the window is fewer than 4
    - **Then** an inline warning is shown in the FFT panel: "Selection too short — at least 4 samples required for FFT"
    - **And** no API call is dispatched

  - **Scenario 3 — User resizes the brush from one handle**
    - **Given** an active brush selection `[t1, t2]` exists
    - **When** the user drags one handle to widen or narrow the selection to `[t1, t3]`
    - **Then** the debounce timer resets and the FFT request fires 300 ms after the drag ends with the updated `start_s` / `end_s`

  - **Scenario 4 — User pans the brush without resizing**
    - **Given** an active brush selection of width `Δt` exists
    - **When** the user pans the entire selection to a new time position
    - **Then** the FFT request fires (debounced) with the new `start_s` / `end_s`
    - **And** the displayed `window_size` (samples) is unchanged

  - **Scenario 5 — User clears the brush selection**
    - **Given** an active brush selection exists
    - **When** the user clicks a "Clear selection" button or double-clicks outside the brush
    - **Then** the exploration window is reset to `null`
    - **And** the FFT panel shows a placeholder: "Select a time window above to begin exploration"
    - **And** no pending API calls are dispatched

  - **Scenario 6 — Multi-channel signal: channel must be selected**
    - **Given** the processed signal has more than one channel
    - **When** the exploration view loads
    - **Then** a channel selector (dropdown) is shown above the chart
    - **And** the brush selection and FFT apply to the currently selected channel
    - **And** switching the channel clears the current brush and FFT result

- **Business Rules:**
  - The brush selection operates on the `timestamp_s` axis of the processed Parquet file, not on screen pixels.
  - The exploration view renders a single selected channel at a time; if no channel is selected the view prompts selection before enabling the brush.
  - The `window_size` sent to the FFT API is the smallest power of 2 that is ≥ the sample count in the brushed range, capped at `131072`.

- **UI/UX Notes:**
  - The exploration time-series chart is a condensed version of the existing `MultiChannelMacroChart` with Plotly's `dragmode: 'select'` enabled.
  - The brush handle color and shaded fill must use the project's `--sp-surface-elevated` token for dark-theme consistency.
  - A compact info bar beneath the chart displays: `Selection: {duration_ms:.1f} ms · {n_samples} samples · window_size → {w} (next power-of-2)`.

---

#### USER STORY-1.2: Real-time FFT Spectrum Panel

- **User Story:** As a data scientist with an active brush selection, I want the FFT magnitude spectrum of that segment to render automatically in an adjacent panel and update in near real-time as I resize or move the window, so that I can assess how different window sizes and positions affect frequency resolution and feature visibility.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Valid selection triggers FFT API call**
    - **Given** the user has an active brush selection with sample count ≥ 4
    - **When** the 300 ms debounce timer expires
    - **Then** a `GET /signals/{id}/analysis/stft` request is dispatched with `channel_name`, `start_s`, `end_s`, `window_size` (next power of 2), `window_fn`
    - **And** a loading skeleton is shown in the FFT panel

  - **Scenario 2 — Spectrum renders with frequency metadata**
    - **Given** the `STFTResponse` is received
    - **When** the FFT panel renders
    - **Then** a Plotly line chart shows Frequency (Hz) on the x-axis and Magnitude on the y-axis
    - **And** the panel header shows: `{window_size} samples @ {sampling_rate_hz:.1f} Hz | Duration: {window_ms:.1f} ms | Freq. resolution: {freq_res:.3f} Hz`
    - **And** if `dominant_frequency_hz` is non-null, a vertical dashed line with a label is drawn at that frequency

  - **Scenario 3 — Previous spectrum is retained while loading**
    - **Given** a spectrum from a prior selection is displayed
    - **When** a new brush interaction triggers a new API call
    - **Then** the prior spectrum is dimmed (opacity 40 %) but not cleared
    - **And** a loading overlay with a spinner replaces it only once the new response arrives

  - **Scenario 4 — API error response**
    - **Given** the API returns a 4xx or 5xx response
    - **When** the FFT panel receives the error
    - **Then** an error banner is shown: "FFT failed: {error message}"
    - **And** any prior spectrum is hidden and the loading state is cleared

  - **Scenario 5 — Concurrent debounce: only the latest request matters**
    - **Given** the user rapidly resizes the brush and multiple debounce timers queue
    - **When** a new brush event arrives before a previous debounce fires
    - **Then** the previous timer is cancelled and only the final selection triggers an API call
    - **And** any in-flight API response older than the latest request is silently discarded

- **Business Rules:**
  - Only one FFT API call is in flight at a time per exploration panel; a new call cancels the previous abort controller.
  - The `window_size` value displayed in the spectrum header is sourced from `STFTResponse.window_config.window_size`, not the local estimate, to confirm the backend used the expected transform length.
  - Frequency resolution (`freq_res`) is derived as `sampling_rate_hz / window_size`.

- **UI/UX Notes:**
  - The FFT panel uses the same dark background and high-contrast line style as the existing `MicroChart` component.
  - The x-axis uses a linear scale in Hz. For low sampling rates, scale to kHz if `sampling_rate_hz > 10000`.
  - The dominant frequency annotation uses the project's `OOC_MARKER` color from `lib/chartTheme.ts` to stand out.

---

### EPIC-2: STFT Parameter Lock & Global Spectrogram

**Description:** After the analyst has identified the window size that best resolves the target feature, they lock that parameter. A slider then controls the overlap ratio. Upon confirmation, the system performs a full sliding-window STFT across the entire signal and renders the resulting spectrogram heatmap. The heatmap's time axis is strictly aligned and synchronized with the macro time-series chart, completing the closed-loop workflow from local exploration to global state inspection.

---

#### USER STORY-2.1: Window Size Lock-In

- **User Story:** As a data scientist who has found the optimal window size during exploration, I want to click a "Lock Window Size" button to freeze that parameter, so that I can proceed to overlap configuration and spectrogram generation with confidence.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Lock button captures current window_size**
    - **Given** an active FFT result is displayed with `window_size = N`
    - **When** the user clicks "Lock Window Size"
    - **Then** the parameter panel shows "Locked: {N} samples" with a lock icon
    - **And** the "Generate Spectrogram" button becomes enabled
    - **And** the brush and FFT panel remain usable for comparison (exploration is not frozen)

  - **Scenario 2 — Generate button is disabled without a lock**
    - **Given** no window size has been locked
    - **Then** the "Generate Spectrogram" button is disabled
    - **And** a tooltip reads: "Lock a window size first by exploring a time window above"

  - **Scenario 3 — User unlocks to re-explore**
    - **Given** a window size is locked
    - **When** the user clicks the "Unlock" button
    - **Then** the locked state is cleared
    - **And** the "Generate Spectrogram" button is disabled again
    - **And** the exploration workflow continues uninterrupted

  - **Scenario 4 — Window function selection**
    - **Given** the parameter controls panel is visible
    - **Then** a "Window Function" dropdown (Hann [default], Hamming, Blackman, Bartlett, Flat Top, Boxcar) is shown
    - **And** selecting a different window function triggers a new FFT call using the current brush selection
    - **And** the selected window function is included in the spectrogram request

- **Business Rules:**
  - The locked `window_size` must be a power of 2 in the range `[4, 131072]`; this is guaranteed by the brush-to-sample conversion logic.
  - The window function selection persists across unlock/re-lock cycles unless the user explicitly changes it.

- **UI/UX Notes:**
  - The lock button transitions: `[Lock Window Size]` → locked state → `Locked ✓ {N} samples` + `[Unlock]` side-by-side.
  - Use the project's `brand-500` color for the locked state indicator to make it visually distinct.

---

#### USER STORY-2.2: Overlap Ratio Configuration

- **User Story:** As a data scientist who has locked a window size, I want to use an overlap slider to configure the hop size, so that I can control the tradeoff between time resolution and the number of STFT windows computed before generating the spectrogram.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Slider renders with sensible default**
    - **Given** a window size is locked
    - **When** the overlap section becomes active
    - **Then** an "Overlap (%)" slider is shown with default value 50 %
    - **And** the slider range is 0 % (no overlap) to 95 %
    - **And** a computed label shows: `hop_size: {H} samples`

  - **Scenario 2 — Slider movement recalculates hop_size and preview**
    - **Given** locked `window_size = W` and the user moves the slider to overlap `P %`
    - **When** the slider value changes
    - **Then** `hop_size = max(1, round(W × (1 − P / 100)))` is computed
    - **And** the preview updates: `~{n_windows} windows across the full signal`
    - **Where** `n_windows = floor((signal_length_samples − W) / hop_size) + 1`

  - **Scenario 3 — hop_size floor protection**
    - **Given** `window_size` is large and overlap approaches 100 %
    - **When** computed `hop_size < 1`
    - **Then** `hop_size` is clamped to `1`
    - **And** the slider stops updating `n_windows` beyond this floor

- **Business Rules:**
  - The overlap slider is enabled only when a window size is locked.
  - `hop_size` must satisfy `1 ≤ hop_size ≤ window_size`; values outside this range are clamped.
  - Signal length in samples is estimated as `ceil(signal_duration_s × sampling_rate_hz)`, sourced from the last `STFTResponse.sampling_rate_hz` and the signal's `x` array length from the `MacroViewResponse`.

- **UI/UX Notes:**
  - Display the slider and hop_size label on the same row; the preview `n_windows` count appears below as secondary text.
  - Gray out the overlap section entirely when no window size is locked.

---

#### USER STORY-2.3: Full-Signal Spectrogram Generation & Heatmap Rendering

- **User Story:** As a data scientist with confirmed STFT parameters, I want to click "Generate Spectrogram" to compute and render the full-signal spectrogram as a high-contrast heatmap, so that I can inspect the temporal evolution of frequency content across the entire recording.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Happy path: spectrogram renders**
    - **Given** a window size is locked, overlap is configured, and a channel is selected
    - **When** the user clicks "Generate Spectrogram"
    - **Then** a `GET /signals/{id}/analysis/spectrogram` request is dispatched with `channel_name`, `window_size`, `hop_size`, `window_fn`
    - **And** upon a 200 response the spectrogram panel renders a Plotly heatmap with:
      - X-axis: time in seconds (or absolute datetime if `t0_epoch_s` is available)
      - Y-axis: frequency in Hz
      - Color dimension: dBFS intensity using the **Viridis** colorscale
      - Colorbar: labeled "dBFS"

  - **Scenario 2 — Loading state during computation**
    - **Given** the generate request has been dispatched
    - **When** the backend is computing
    - **Then** the spectrogram panel shows a skeleton placeholder labeled "Computing spectrogram…"
    - **And** the "Generate Spectrogram" button is disabled and shows a spinner

  - **Scenario 3 — Payload too large (HTTP 413)**
    - **Given** the spectrogram matrix would exceed the backend `STFT_MAX_RESPONSE_MB` limit
    - **When** the API returns 413
    - **Then** an error message is shown: "Spectrogram too large — try increasing the overlap (lower hop_size) or reducing window size"

  - **Scenario 4 — Signal too short (HTTP 422)**
    - **Given** the signal length in samples is less than `window_size`
    - **When** the API returns 422
    - **Then** an error message is shown: "Signal is too short for the selected window size. Reduce window size and try again."

  - **Scenario 5 — Downsampled time axis notice**
    - **Given** the `SpectrogramResponse.downsampled` field is `true`
    - **When** the heatmap renders
    - **Then** a notice below the chart reads: "⚠ Time axis downsampled to 2 000 bins for display"

  - **Scenario 6 — Re-generate with new parameters**
    - **Given** a spectrogram is already rendered
    - **When** the user unlocks, changes parameters, and clicks "Generate Spectrogram" again
    - **Then** the existing spectrogram is replaced by the loading skeleton
    - **And** the new spectrogram replaces it upon completion

- **Business Rules:**
  - Only one spectrogram request can be in flight at a time; a new "Generate" click cancels the previous request.
  - The spectrogram is rendered for a single selected channel only.

- **UI/UX Notes:**
  - Colorscale must be `Viridis` (not `Jet`) to conform to scientific visualization aesthetics defined in `lib/chartTheme.ts`.
  - The spectrogram panel is hidden (collapsed) until the first successful generation, to avoid blank space before any parameters are confirmed.

---

#### USER STORY-2.4: Spectrogram–Time-Series X-Axis Alignment

- **User Story:** As a data scientist viewing both the macro time-series chart and the generated spectrogram, I want the spectrogram's time axis to be synchronized with the time-series chart so that I can directly correlate temporal events in the raw signal with their spectral fingerprint.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Synchronized zoom/pan**
    - **Given** both the macro time-series chart and the spectrogram heatmap are displayed
    - **When** the user zooms or pans the time axis in either chart
    - **Then** the other chart's time axis updates to match the same visible range

  - **Scenario 2 — Absolute datetime labels when t0_epoch_s is set**
    - **Given** the signal has `t0_epoch_s` (datetime x-axis)
    - **When** the spectrogram heatmap renders
    - **Then** the time axis shows absolute datetime labels (matching the format used in `MultiChannelMacroChart.tsx`)

  - **Scenario 3 — Exploration brush overlaid on spectrogram**
    - **Given** the user has an active brush selection `[t1, t2]` on the macro chart
    - **When** the spectrogram is displayed
    - **Then** a vertical shaded band at `[t1, t2]` is drawn on the spectrogram to indicate the exploration region

  - **Scenario 4 — No spectrogram rendered yet: macro chart is unaffected**
    - **Given** the spectrogram has not yet been generated
    - **Then** the macro time-series chart behaves identically to its state before the exploration view was opened

- **Business Rules:**
  - The shared x-axis range state is managed in the `useSTFTExplorer` hook; both charts subscribe to the same `xRange` state and dispatch `setXRange` on Plotly `relayout` events.
  - The time-axis unit on the spectrogram (`time_bins_s`) is offset by `t0_epoch_s` when present, identical to the macro chart's x-axis computation.

- **UI/UX Notes:**
  - The exploration brush shaded region on the spectrogram uses `rgba` with 20 % opacity to avoid obscuring the heatmap data.
  - A "Reset Zoom" button resets both charts to their full extent simultaneously.

---

## 3. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance — FFT** | `GET /signals/{id}/analysis/stft` must respond within 500 ms for segments up to `window_size = 131072` samples, measured on a single-core backend. |
| **Performance — Interaction** | Brush interactions are debounced to 300 ms. In-flight FFT requests are aborted on superseded selections. No render-blocking during rapid window resizing. |
| **Performance — Heatmap** | Spectrogram heatmap must render a `2000 × 1024` matrix without UI freeze; Plotly's WebGL heatmap renderer must be preferred when available. |
| **Backward Compatibility** | The existing signal upload → configure → macro-view workflow is entirely unaffected. The STFT exploration view is an additive UI section on the signal detail page. |
| **API Compatibility** | Feature 8 consumes the already-existing `/signals/{id}/analysis/stft` and `/signals/{id}/analysis/spectrogram` endpoints without modification. |
| **Usability — Workflow Guidance** | The four-phase workflow (Explore → Lock → Configure → Generate) must be communicated through progressive disclosure: each phase's controls are visible only when its prerequisites are met. |
| **Accessibility** | All interactive controls (brush toolbar, overlap slider, lock/generate buttons, channel selector) must have `aria-label` attributes and be keyboard-accessible. |
| **Scientific Visualization** | Spectrogram colorscale must be Viridis. FFT spectrum line chart must use the dark-background, high-contrast style established in `lib/chartTheme.ts`. No `Jet` colorscale. |
| **Error Recovery** | All error states (API failure, payload too large, signal too short) must display actionable guidance text and allow the user to retry without refreshing the page. |

---

## 4. Out-of-Scope

The following are explicitly excluded from this feature to prevent scope creep:

| Item | Reason |
|---|---|
| Cross-spectral analysis of multiple channels simultaneously | Architecturally complex; single-channel scope per system boundary |
| Data interpolation for non-uniformly sampled signals | System assumes constant sampling rate inferred from median inter-sample interval |
| Automated raw signal denoising or pre-filtering | Separate future feature; out of brief |
| Reverse-engineering or editing the raw signal from the spectrogram | Read-only visualization |
| 3D waterfall plot (time × frequency × amplitude surface) | Explicitly excluded per brief |
| Automated spectral peak detection and annotation | Explicitly excluded per brief |
| Continuous Wavelet Transform (CWT) or Hilbert-Huang Transform (HHT) | Deferred advanced transforms |
| Real-time STFT for streaming/infinite data | Scope restricted to static CSV files with defined start and end points |
| Spectrogram export (PNG / CSV) | Deferred utility feature |
| Applying STFT results to modify signal processing pipeline | Read-only analysis; no write-back to pipeline |

---

## 5. Glossary & Definitions

| Term | Definition |
|---|---|
| **Exploration Window** | The time range `[start_s, end_s]` selected by the analyst via brush interaction on the macro chart. Drives the live FFT preview. |
| **FFT (Fast Fourier Transform)** | The one-sided real FFT magnitude spectrum of the exploration window, computed by the backend `compute_stft` domain function. |
| **window_size** | The FFT transform length in samples (must be a power of 2). Set automatically to the smallest power of 2 ≥ the sample count in the brushed range, capped at 131 072. |
| **hop_size** | The number of samples to advance between successive STFT frames. Derived as `max(1, round(window_size × (1 − overlap_ratio / 100)))`. |
| **Overlap Ratio** | Percentage of overlap between adjacent STFT windows (0 %–95 %). Higher overlap = finer time resolution = more STFT windows. |
| **dBFS** | Decibels relative to full scale: `20 × log₁₀(magnitude / peak + ε)`. 0 dBFS = peak; negative values indicate below-peak energy. |
| **Spectrogram** | A 2D heatmap of time × frequency intensity (dBFS), computed by sliding the STFT window across the full signal at `hop_size` intervals. |
| **Frequency Resolution** | The frequency spacing between FFT bins: `sampling_rate_hz / window_size`. Smaller values reveal finer spectral features. |
| **sampling_rate_hz** | Uniform sampling rate estimated from the median inter-sample interval of the processed Parquet `timestamp_s` column. |
| **t0_epoch_s** | Unix epoch (seconds, float) of the first data point. Used by both the macro chart and spectrogram to reconstruct absolute datetime x-axis labels. |
| **Debounce** | A UI pattern that delays firing an API call until a minimum quiet interval (300 ms) has elapsed, preventing excessive requests during rapid brush interaction. |
| **STFT_MAX_RESPONSE_MB** | Backend environment variable capping the spectrogram payload size. Requests exceeding this limit receive HTTP 413. |
| **Viridis** | A perceptually uniform, sequential colorscale used for the spectrogram heatmap, chosen for scientific visualization integrity and accessibility (colorblind-safe). |
