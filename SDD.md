# Software Design Document

**Product:** signal-probe
**Feature:** Interactive STFT Parameter Exploration & Spectrogram Generation
**Version:** 1.0
**Date:** 2026-04-25
**Status:** Draft
**Related SRS:** `SRS.md`

---

## Table of Contents

1. [Introduction & Scope](#1-introduction--scope)
2. [System Architecture (HLD)](#2-system-architecture-hld)
3. [Domain-Driven Design Mapping](#3-domain-driven-design-mapping)
4. [Component Design (LLD)](#4-component-design-lld)
   - [4.1 Backend — No New Endpoints Required](#41-backend--no-new-endpoints-required)
   - [4.2 Frontend — Type Definitions](#42-frontend--type-definitions)
   - [4.3 Frontend — Hook: useSTFTExplorer](#43-frontend--hook-usestftexplorer)
   - [4.4 Frontend — Component: STFTExplorerPanel](#44-frontend--component-stftexplorerpanel)
   - [4.5 Frontend — Component: FFTSpectrumChart](#45-frontend--component-fftspectrumchart)
   - [4.6 Frontend — Component: SpectrogramChart](#46-frontend--component-spectrogramchart)
   - [4.7 Frontend — Component: STFTParamControls](#47-frontend--component-stftparamcontrols)
   - [4.8 Frontend — lib/api.ts additions](#48-frontend--libapts-additions)
   - [4.9 Frontend — SignalsPage integration](#49-frontend--signalspage-integration)
5. [Data Design](#5-data-design)
6. [API Contracts](#6-api-contracts)
7. [UI & Interaction Design](#7-ui--interaction-design)
8. [Technical Specifications & NFRs](#8-technical-specifications--nfrs)

---

## 1. Introduction & Scope

### 1.1 Purpose

This document defines the technical design for the **Interactive STFT Parameter Exploration & Spectrogram Generation** feature (Feature 8). The feature adds a self-contained exploration view to signal-probe's signal detail page that lets analysts:

1. **Brush-select** a time window on the macro chart to drive a live FFT preview.
2. **Lock** the validated window size and configure the overlap ratio.
3. **Generate** a full-signal STFT spectrogram rendered as a synchronized, high-contrast heatmap.

### 1.2 System Boundaries

**In scope:**
- New frontend components: `STFTExplorerPanel`, `FFTSpectrumChart`, `SpectrogramChart`, `STFTParamControls`.
- New frontend hook: `useSTFTExplorer` (state machine for the four-phase workflow).
- `lib/api.ts` additions: `fetchSTFT` and `fetchSpectrogram` helper functions.
- Integration into `SignalsPage.tsx`: exploration view mounted below the macro chart for `COMPLETED` signals.
- Plotly brush interaction wiring in the exploration time-series chart.
- Synchronized x-axis range between macro chart and spectrogram.

**Out of scope:**
- Backend changes: the existing `GET /signals/{id}/analysis/stft` and `GET /signals/{id}/analysis/spectrogram` endpoints are consumed as-is.
- Database schema changes.
- Any modification to the upload/configure/macro workflow.
- Multi-channel simultaneous STFT, data denoising, 3D waterfall, peak detection (see SRS §4).

### 1.3 Stakeholders

| Role | Interest |
|---|---|
| Data scientists | Visual STFT parameter exploration; synchronized spectrogram |
| Frontend developers | New hook, new components, Plotly brush integration |
| Backend developers | Confirmation that existing analysis endpoints are sufficient |

---

## 2. System Architecture (HLD)

Feature 8 is **entirely a frontend extension**. The backend STFT engine, service, and API endpoints introduced in Feature 6 already provide all the computation needed. The new work sits exclusively in the React/Plotly presentation layer.

```
┌──────────────────────────────────────────────────────────────────────┐
│  SignalsPage.tsx                                                      │
│                                                                       │
│  ┌─────────────────────────────┐   ┌───────────────────────────────┐  │
│  │  MultiChannelMacroChart     │   │  STFTExplorerPanel            │  │
│  │  (existing — read-only)     │   │  (new — exploration view)     │  │
│  └─────────────────────────────┘   │                               │  │
│                                    │  ┌────────────────────────┐   │  │
│                                    │  │ Exploration chart      │   │  │
│                                    │  │ (Plotly + brush mode)  │   │  │
│                                    │  └──────────┬─────────────┘   │  │
│                                    │             │ brush event      │  │
│                                    │  ┌──────────▼─────────────┐   │  │
│                                    │  │ useSTFTExplorer hook   │   │  │
│                                    │  │ (state machine)        │   │  │
│                                    │  └────┬──────────┬────────┘   │  │
│                                    │       │          │             │  │
│                                    │  ┌────▼──┐  ┌───▼──────────┐ │  │
│                                    │  │ FFT   │  │ STFTParam    │ │  │
│                                    │  │Spectrum│  │Controls      │ │  │
│                                    │  │Chart  │  │(lock/overlap)│ │  │
│                                    │  └───────┘  └──────┬───────┘ │  │
│                                    │                    │generate  │  │
│                                    │  ┌─────────────────▼───────┐ │  │
│                                    │  │ SpectrogramChart        │ │  │
│                                    │  │ (Plotly heatmap)        │ │  │
│                                    │  └─────────────────────────┘ │  │
│                                    └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                         │ GET /signals/{id}/analysis/stft
                         │ GET /signals/{id}/analysis/spectrogram
┌────────────────────────▼─────────────────────────────────────────────┐
│  FastAPI — Existing analysis endpoints (Feature 6, unchanged)         │
│  GET /signals/{id}/analysis/stft        → STFTResponse               │
│  GET /signals/{id}/analysis/spectrogram → SpectrogramResponse        │
└──────────────────────────────────────────────────────────────────────┘
```

**Key external dependencies:** Plotly.js (brush/lasso selection, heatmap), React 19, existing `lib/api.ts`, `lib/chartTheme.ts`.

---

## 3. Domain-Driven Design Mapping

### 3.1 Bounded Contexts

| Context | Aggregate Root | Relevance to Feature 8 |
|---|---|---|
| **Signal Analysis** | `STFTResponse` / `SpectrogramResponse` (read models) | Consumed by the new exploration components; no mutations |
| **Signal Visualisation** | `MacroViewResponse` | Shared x-axis range synchronized with spectrogram |

### 3.2 New Value Objects (Frontend Only)

| Value Object | Location | Description |
|---|---|---|
| `ExplorationWindow` | `useSTFTExplorer` state | `{ start_s: number; end_s: number; sampleCount: number; windowSize: number }` — immutable snapshot of a brush selection. `windowSize` = next power of 2 ≥ `sampleCount`. |
| `STFTParams` | `useSTFTExplorer` state | `{ windowSize: number; overlapPct: number; hopSize: number; windowFn: WindowFunction }` — the confirmed parameter set sent to the spectrogram endpoint. |

### 3.3 Exploration Phase State Machine

```
IDLE
  │  user brushes selection
  ▼
EXPLORING ─── brush cleared ──► IDLE
  │  FFT response received + user clicks "Lock"
  ▼
LOCKED ──── user clicks "Unlock" ──► EXPLORING
  │  user clicks "Generate Spectrogram"
  ▼
GENERATING
  │  SpectrogramResponse received
  ▼
SPECTROGRAM_READY ──── user unlocks ──► EXPLORING
  │  user changes parameters and regenerates
  ▼
GENERATING  (loop)
```

### 3.4 Domain Events (Frontend)

| Event | Trigger | Effect |
|---|---|---|
| `BrushUpdated` | Plotly `relayout` with `xaxis.range` in select mode | Debounced FFT call dispatched; `ExplorationWindow` updated |
| `FFTReceived` | Successful `fetchSTFT` response | FFT spectrum re-rendered; `samplingRateHz` cached |
| `WindowLocked` | User clicks "Lock Window Size" | Phase transitions to `LOCKED`; `STFTParams.windowSize` frozen |
| `OverlapChanged` | Slider `onChange` | `hopSize` recalculated; `n_windows` preview updated |
| `GenerateClicked` | User clicks "Generate Spectrogram" | Phase transitions to `GENERATING`; `fetchSpectrogram` dispatched |
| `SpectrogramReceived` | Successful `fetchSpectrogram` response | Phase transitions to `SPECTROGRAM_READY`; heatmap rendered |
| `XRangeChanged` | Plotly `relayout` on either synced chart | Shared `xRange` state updated; both charts re-render with new range |

---

## 4. Component Design (LLD)

### 4.1 Backend — No New Endpoints Required

Both analysis endpoints from Feature 6 are already registered and fully functional:

| Endpoint | Consumed by Feature 8 for |
|---|---|
| `GET /signals/{id}/analysis/stft` | Live FFT spectrum during exploration |
| `GET /signals/{id}/analysis/spectrogram` | Full spectrogram generation |

No backend changes are required.

---

### 4.2 Frontend — Type Definitions

**File:** `frontend/src/types/signal.ts`

```typescript
// ── Exploration types (Feature 8) ────────────────────────────────────────────

export type WindowFunction =
  | 'hann' | 'hamming' | 'blackman' | 'bartlett'
  | 'flattop' | 'boxcar' | 'nuttall' | 'blackmanharris';

export interface STFTResponse {
  signal_id: string;
  channel_name: string;
  frequencies_hz: number[];
  magnitudes: number[];
  dominant_frequency_hz: number | null;
  window_config: {
    start_s: number;
    end_s: number;
    window_fn: WindowFunction;
    window_size: number;
  };
  sampling_rate_hz: number;
}

export interface SpectrogramResponse {
  signal_id: string;
  channel_name: string;
  time_bins_s: number[];           // shape (n_time,)
  frequency_bins_hz: number[];     // shape (n_freq,)
  magnitude_db: number[][];        // shape (n_time, n_freq)
  sampling_rate_hz: number;
  downsampled: boolean;
}

export interface ExplorationWindow {
  start_s: number;
  end_s: number;
  sampleCount: number;
  windowSize: number;              // next power of 2 >= sampleCount
}

export type ExplorationPhase =
  | 'idle'
  | 'exploring'
  | 'locked'
  | 'generating'
  | 'spectrogram_ready';
```

---

### 4.3 Frontend — Hook: useSTFTExplorer

**File:** `frontend/src/hooks/useSTFTExplorer.ts`

This hook is the single source of truth for the entire exploration workflow. It owns the phase state machine and all async side-effects.

#### State Shape

```typescript
interface STFTExplorerState {
  phase: ExplorationPhase;

  // Exploration
  channel: string | null;
  window: ExplorationWindow | null;

  // FFT result
  fftResult: STFTResponse | null;
  fftLoading: boolean;
  fftError: string | null;

  // Parameters (locked)
  windowFn: WindowFunction;
  lockedWindowSize: number | null;
  overlapPct: number;              // 0–95; default 50
  hopSize: number;                 // derived: max(1, round(lockedWindowSize * (1 - overlapPct/100)))

  // Spectrogram result
  spectrogramResult: SpectrogramResponse | null;
  spectrogramLoading: boolean;
  spectrogramError: string | null;

  // Shared x-axis range (synced between charts)
  xRange: [number, number] | null;
}
```

#### Key Action Handlers

```typescript
// Called by the Plotly onRelayout callback in select/dragmode:
function onBrushChange(start_s: number, end_s: number, samplingRate: number): void {
  // 1. Compute sampleCount from (end_s - start_s) * samplingRate
  // 2. Compute windowSize = nextPowerOfTwo(sampleCount), clamp to [4, 131072]
  // 3. If sampleCount < 4: set fftError, return
  // 4. Update state.window; set phase = 'exploring'
  // 5. Clear any pending debounce timer; schedule new fetchFFT in 300 ms
}

function onBrushClear(): void {
  // Reset window, fftResult, fftError; set phase = 'idle'
}

async function fetchFFT(): Promise<void> {
  // Abort previous in-flight request via AbortController
  // Call api.fetchSTFT(signalId, channel, window, windowFn)
  // On success: set fftResult, cache samplingRateHz
  // On error: set fftError; clear fftLoading
}

function lockWindowSize(): void {
  // Set lockedWindowSize = fftResult.window_config.window_size
  // Recalculate hopSize; set phase = 'locked'
}

function unlockWindowSize(): void {
  // Clear lockedWindowSize; set phase = 'exploring'
}

function onOverlapChange(pct: number): void {
  // Clamp pct to [0, 95]
  // hopSize = max(1, round(lockedWindowSize * (1 - pct / 100)))
  // Update overlapPct, hopSize in state
}

async function generateSpectrogram(): Promise<void> {
  // Abort any previous spectrogram request
  // Set phase = 'generating', spectrogramLoading = true
  // Call api.fetchSpectrogram(signalId, channel, lockedWindowSize, hopSize, windowFn)
  // On success: set spectrogramResult, phase = 'spectrogram_ready'
  // On error: set spectrogramError, phase = 'locked'
}

function onXRangeChange(range: [number, number]): void {
  // Update shared xRange; consumed by both Plotly charts via uirevision
}
```

#### nextPowerOfTwo Helper

```typescript
function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 4;               // minimum window_size
  let p = 1;
  while (p < n) p <<= 1;
  return Math.min(p, 131072);         // maximum window_size
}
```

---

### 4.4 Frontend — Component: STFTExplorerPanel

**File:** `frontend/src/components/STFTExplorerPanel.tsx`

Top-level container for the exploration workflow. Renders all sub-components and manages layout.

```typescript
interface STFTExplorerPanelProps {
  signalId: string;
  channelNames: string[];
  macroData: MacroViewResponse;     // for x-axis range sync and sampling rate
}
```

**Layout (top → bottom):**
1. **Channel selector** (dropdown, shown when `channelNames.length > 1`).
2. **Exploration time-series chart** — Plotly line chart with `dragmode: 'select'`; brush callback wired to `onBrushChange`.
3. **Info bar** — window duration, sample count, `window_size` (next power of 2).
4. **FFT Spectrum panel** (`FFTSpectrumChart`) and **Parameter controls** (`STFTParamControls`) side by side.
5. **Spectrogram panel** (`SpectrogramChart`) — conditionally rendered when `phase !== 'idle'`.

**Responsibilities:**
- Instantiates `useSTFTExplorer` and distributes state/actions as props.
- Renders a collapsible section heading: "STFT Parameter Exploration".
- Shows the exploration panel only for `COMPLETED` signals; renders a disabled placeholder with "Signal must be fully processed to use exploration" otherwise.

---

### 4.5 Frontend — Component: FFTSpectrumChart

**File:** `frontend/src/components/FFTSpectrumChart.tsx`

Renders the real-time FFT magnitude spectrum.

```typescript
interface FFTSpectrumChartProps {
  result: STFTResponse | null;
  loading: boolean;
  error: string | null;
}
```

**Rendering logic:**
- **`loading && result === null`** → skeleton placeholder.
- **`loading && result !== null`** → dim prior spectrum (opacity 0.4) + spinner overlay.
- **`error`** → error banner with message.
- **`result`** → Plotly `scatter` trace (`mode: 'lines'`) with `frequencies_hz` on x, `magnitudes` on y.

**Chart configuration:**
- Dark background matching `--sp-surface-secondary`.
- `buildChartTheme(theme)` applied from `lib/chartTheme.ts`.
- Dominant frequency annotated as a vertical dashed line using `shapes` + `annotations` in Plotly layout, colored with the project's `OOC_MARKER` color.
- Panel header:
  ```
  {window_size} samples @ {sampling_rate_hz.toFixed(1)} Hz
  | Duration: {((window_size / sampling_rate_hz) * 1000).toFixed(1)} ms
  | Freq. resolution: {(sampling_rate_hz / window_size).toFixed(3)} Hz
  ```

---

### 4.6 Frontend — Component: SpectrogramChart

**File:** `frontend/src/components/SpectrogramChart.tsx`

Renders the full-signal STFT spectrogram as a Plotly heatmap.

```typescript
interface SpectrogramChartProps {
  result: SpectrogramResponse | null;
  loading: boolean;
  error: string | null;
  t0EpochS: number | null;           // for absolute datetime x-axis
  explorationWindow: ExplorationWindow | null;  // for brush overlay band
  xRange: [number, number] | null;   // shared zoom range
  onXRangeChange: (range: [number, number]) => void;
}
```

**Rendering logic:**
- **`loading`** → skeleton with label "Computing spectrogram…".
- **`error`** → error banner (with specific messages for 413 and 422 per SRS).
- **`result`** → Plotly `heatmap` trace:
  - `z`: `result.magnitude_db` (transposed so rows = frequency, columns = time).
  - `x`: `result.time_bins_s` (offset by `t0EpochS` if present using `new Date((t0EpochS + t) * 1000)`).
  - `y`: `result.frequency_bins_hz`.
  - `colorscale: 'Viridis'`.
  - `colorbar.title: 'dBFS'`.
  - `zsmooth: 'fast'` for GPU-accelerated rendering.
- **Downsampled notice**: shown as a `<p>` element below the chart when `result.downsampled === true`.
- **Brush overlay**: when `explorationWindow` is set, a Plotly `shape` with `type: 'rect'`, `x0/x1` from the window bounds, full `y0/y1` extent, `fillcolor: 'rgba(255,255,255,0.12)'`, `line.width: 0`.
- **X-axis sync**: Plotly `onRelayout` calls `onXRangeChange` when `xaxis.range[0]` or `xaxis.range[1]` changes.
- `uirevision` set to the shared `xRange` JSON string to prevent Plotly re-initialising on every render.

---

### 4.7 Frontend — Component: STFTParamControls

**File:** `frontend/src/components/STFTParamControls.tsx`

Controls for window lock, window function, overlap slider, and spectrogram generation trigger.

```typescript
interface STFTParamControlsProps {
  phase: ExplorationPhase;
  fftResult: STFTResponse | null;
  lockedWindowSize: number | null;
  windowFn: WindowFunction;
  overlapPct: number;
  hopSize: number;
  signalLengthSamples: number;        // for n_windows preview
  onLock: () => void;
  onUnlock: () => void;
  onWindowFnChange: (fn: WindowFunction) => void;
  onOverlapChange: (pct: number) => void;
  onGenerate: () => void;
  spectrogramLoading: boolean;
}
```

**Rendering sections (top → bottom):**

1. **Window Function selector** — `<select>` with options: Hann (default), Hamming, Blackman, Bartlett, Flat Top, Boxcar. Enabled in `exploring` and `locked` phases.

2. **Lock / Unlock row:**
   - `phase === 'exploring'` and `fftResult !== null`: "Lock Window Size" button (primary).
   - `phase === 'locked' | 'generating' | 'spectrogram_ready'`: "Locked ✓ {lockedWindowSize} samples" badge + "Unlock" button (secondary).

3. **Overlap section** — visible and enabled when `lockedWindowSize !== null`:
   - Label: "Overlap (%)"
   - `<input type="range" min={0} max={95} step={5} />`
   - Derived label: `hop_size: {hopSize} samples`
   - Preview: `~{nWindows} windows across the full signal`

4. **Generate button** — disabled when `phase !== 'locked'` or when `spectrogramLoading`. Shows spinner during `generating` phase.

---

### 4.8 Frontend — lib/api.ts additions

**File:** `frontend/src/lib/api.ts`

```typescript
export async function fetchSTFT(
  signalId: string,
  channelName: string,
  window: ExplorationWindow,
  windowFn: WindowFunction,
  signal?: AbortSignal,
): Promise<STFTResponse> {
  const params = new URLSearchParams({
    channel_name: channelName,
    start_s:      window.start_s.toString(),
    end_s:        window.end_s.toString(),
    window_size:  window.windowSize.toString(),
    window_fn:    windowFn,
  });
  const res = await apiFetch(
    `/signals/${signalId}/analysis/stft?${params}`,
    { signal },
  );
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<STFTResponse>;
}

export async function fetchSpectrogram(
  signalId: string,
  channelName: string,
  windowSize: number,
  hopSize: number,
  windowFn: WindowFunction,
  signal?: AbortSignal,
): Promise<SpectrogramResponse> {
  const params = new URLSearchParams({
    channel_name: channelName,
    window_size:  windowSize.toString(),
    hop_size:     hopSize.toString(),
    window_fn:    windowFn,
  });
  const res = await apiFetch(
    `/signals/${signalId}/analysis/spectrogram?${params}`,
    { signal },
  );
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<SpectrogramResponse>;
}
```

---

### 4.9 Frontend — SignalsPage integration

**File:** `frontend/src/pages/SignalsPage.tsx`

The exploration view is mounted conditionally below the existing macro chart when the selected signal has status `COMPLETED`:

```tsx
{selectedSignal?.status === 'COMPLETED' && macroData && (
  <STFTExplorerPanel
    signalId={selectedSignal.id}
    channelNames={selectedSignal.channel_names ?? []}
    macroData={macroData}
  />
)}
```

The `MultiChannelMacroChart` and `STFTExplorerPanel` share an `xRange` state lifted to `SignalsPage` so that zooming in either chart propagates to the other:

```tsx
const [sharedXRange, setSharedXRange] = useState<[number, number] | null>(null);

// Passed to both MultiChannelMacroChart and STFTExplorerPanel
```

---

## 5. Data Design

### 5.1 Processed Parquet (unchanged)

Feature 8 reads from the existing processed Parquet schema produced by the pipeline:

| Column | Type | Description |
|---|---|---|
| `timestamp_s` | Float64 | Elapsed seconds from first point |
| `t0_epoch_s` | Float64 (constant) | Unix epoch of first point; absent for numeric time axis |
| `<channel_name>` | Float64 | Signal amplitude values |
| `<channel_name>_state` | Utf8 | IDLE / ACTIVE per point |
| `__unit_<channel_name>` | Utf8 (constant) | Unit string if configured |

No new columns are added by Feature 8.

### 5.2 Frontend State Persistence

The `useSTFTExplorer` hook state is **component-local** (React `useReducer`). No exploration state is persisted to `localStorage`, the database, or URL parameters. Navigating away from the signal detail page resets the exploration workflow.

---

## 6. API Contracts

Feature 8 consumes two existing endpoints. Their contracts are reproduced here for reference.

### 6.1 GET /signals/{signal_id}/analysis/stft

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `channel_name` | string | ✓ | — | Channel column in Parquet |
| `start_s` | float | ✓ | — | Window start (seconds, ≥ 0) |
| `end_s` | float | ✓ | — | Window end (seconds, > start_s) |
| `window_fn` | enum | — | `hann` | Window function |
| `window_size` | int | — | `1024` | FFT length in samples (power of 2, 4–131072) |

**Response 200 — `STFTResponse`:**

```json
{
  "signal_id": "uuid",
  "channel_name": "sensor_a",
  "frequencies_hz": [0.0, 0.976, 1.953, ...],
  "magnitudes": [0.002, 0.845, 0.123, ...],
  "dominant_frequency_hz": 12.5,
  "window_config": { "start_s": 1.0, "end_s": 2.0, "window_fn": "hann", "window_size": 1024 },
  "sampling_rate_hz": 1000.0
}
```

**Error responses:** 404 (signal/channel not found), 409 (signal not COMPLETED), 422 (invalid params / signal too short).

---

### 6.2 GET /signals/{signal_id}/analysis/spectrogram

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `channel_name` | string | ✓ | — | Channel column in Parquet |
| `window_fn` | enum | — | `hann` | Window function |
| `window_size` | int | — | `1024` | FFT frame length (power of 2, 4–131072) |
| `hop_size` | int | — | `512` | Samples between frames (≥ 1) |

**Response 200 — `SpectrogramResponse`:**

```json
{
  "signal_id": "uuid",
  "channel_name": "sensor_a",
  "time_bins_s": [0.512, 1.024, ...],
  "frequency_bins_hz": [0.0, 0.976, ...],
  "magnitude_db": [[-80.2, -72.1, ...], ...],
  "sampling_rate_hz": 1000.0,
  "downsampled": false
}
```

**Error responses:** 404, 409, 413 (payload exceeds `STFT_MAX_RESPONSE_MB`), 422.

---

## 7. UI & Interaction Design

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STFT Parameter Exploration                              [▼ Collapse]    │
├─────────────────────────────────────────────────────────────────────────┤
│  Channel: [sensor_a ▾]                                                  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Exploration Chart  (time-series + drag-to-select brush)          │  │
│  │  Selection: 0.50 s · 512 samples · window_size → 512             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  FFT Spectrum                │  │  STFT Parameters                 │ │
│  │  512 samples @ 1000 Hz       │  │  Window fn: [Hann ▾]            │ │
│  │  Duration: 512 ms            │  │                                  │ │
│  │  Freq. resolution: 1.953 Hz  │  │  [Lock Window Size]              │ │
│  │                              │  │                                  │ │
│  │  [spectrum chart]            │  │  ─── (locked below) ────         │ │
│  │                              │  │  Overlap: [────●────] 50 %       │ │
│  │                              │  │  hop_size: 256 samples           │ │
│  │                              │  │  ~1 950 windows across signal    │ │
│  │                              │  │                                  │ │
│  │                              │  │  [Generate Spectrogram ▶]        │ │
│  └──────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Spectrogram (Viridis heatmap, time × frequency)                  │  │
│  │  [Colorbar: dBFS]  [Reset Zoom]                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Phase Transitions Summary

| Phase | Brush | FFT panel | Lock button | Overlap slider | Generate button |
|---|---|---|---|---|---|
| `idle` | Active | Placeholder | Hidden | Grayed out | Disabled |
| `exploring` | Active | Loading / spectrum | "Lock Window Size" | Grayed out | Disabled |
| `locked` | Active | Spectrum (read-only) | "Locked ✓ N / Unlock" | Active | **Enabled** |
| `generating` | Active | Spectrum (read-only) | "Locked ✓ N" | Active | Spinner / Disabled |
| `spectrogram_ready` | Active | Spectrum | "Locked ✓ N / Unlock" | Active | **Enabled** (re-gen) |

### 7.3 Synchronized X-Axis Zoom

Both the exploration chart and the spectrogram use Plotly's `onRelayout` event to publish `xaxis.range` changes. The shared `xRange` state in `SignalsPage` is passed back as `xaxis.range` (via Plotly's `layout.xaxis.range`) to both charts, achieving synchronized zoom without a separate state management library.

```
User zooms spectrogram
  → SpectrogramChart.onRelayout({ 'xaxis.range[0]': t0, 'xaxis.range[1]': t1 })
  → onXRangeChange([t0, t1])
  → SignalsPage: setSharedXRange([t0, t1])
  → Exploration chart re-renders with layout.xaxis.range = [t0, t1]
  → MultiChannelMacroChart re-renders with layout.xaxis.range = [t0, t1]
```

---

## 8. Technical Specifications & NFRs

| Category | Specification |
|---|---|
| **FFT Latency** | `GET /signals/{id}/analysis/stft` ≤ 500 ms for `window_size ≤ 131072` (single-core backend baseline). |
| **Debounce** | Brush interaction debounce = 300 ms. New brush events within the 300 ms window reset the timer; previous `AbortController` is called before dispatching a new request. |
| **Heatmap Rendering** | `SpectrogramChart` uses Plotly's `heatmap` trace type with `zsmooth: 'fast'` to leverage WebGL acceleration where available. Target: 2000 × 1024 matrix renders without main-thread freeze. |
| **Abort Controller** | One `AbortController` per in-flight request type (FFT, spectrogram). A new request always aborts the prior one. `AbortError` is silently ignored; all other errors surface as `error` state. |
| **No Backend Changes** | Feature 8 introduces zero backend changes. All computation is delegated to the existing Feature 6 analysis endpoints. |
| **Bundle Impact** | No new Plotly import paths; the existing `plotly-dist-min` bundle already includes `Heatmap` and `Scatter` trace types. |
| **Colorscale** | `Viridis` only. `Jet` is forbidden per scientific visualization policy. |
| **Accessibility** | `<select>` channel/window-fn selectors: native `<select>` with `aria-label`. Overlap `<input type="range">`: `aria-label="Overlap percentage"` + `aria-valuenow`. Buttons: descriptive `aria-label` on icon-only variants. |
| **Testing** | Unit tests for `nextPowerOfTwo`, `hopSize` calculation, and phase transition logic in `useSTFTExplorer`. Integration tests for `fetchSTFT` and `fetchSpectrogram` using MSW mocks. Backend endpoints already tested in `backend/tests/`. |
