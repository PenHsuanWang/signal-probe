# Architecture Design Document

**Service:** signal-probe
**Feature:** Interactive STFT Parameter Exploration & Spectrogram Generation
**Architect:** GitHub Copilot (Architecture-Design Skill)
**Version:** 1.0
**Date:** 2026-04-25
**Status:** Draft — For Review

> **Related Documents**
> - Business Requirements: `SRS.md`
> - Technical Specification: `SDD.md`
> - Architecture Decision Records: See §8 of this document.

---

## Table of Contents

1. [Service Identity](#1-service-identity)
2. [C4 Diagrams](#2-c4-diagrams)
   - [2.1 Context Diagram (System Level)](#21-context-diagram-system-level)
   - [2.2 Container Diagram](#22-container-diagram)
   - [2.3 Component Diagram — Backend API Server](#23-component-diagram--backend-api-server)
   - [2.4 Component Diagram — Frontend SPA (Feature 8)](#24-component-diagram--frontend-spa-feature-8)
3. [Domain Model: UML Class Diagram](#3-domain-model-uml-class-diagram)
4. [Interaction Design: UML Sequence Diagrams](#4-interaction-design-uml-sequence-diagrams)
   - [4.1 Brush Exploration → Live FFT Flow](#41-brush-exploration--live-fft-flow)
   - [4.2 Window Lock & Overlap Configuration Flow](#42-window-lock--overlap-configuration-flow)
   - [4.3 Spectrogram Generation & Render Flow](#43-spectrogram-generation--render-flow)
   - [4.4 Synchronized X-Axis Zoom Flow](#44-synchronized-x-axis-zoom-flow)
5. [REST API Contracts](#5-rest-api-contracts)
6. [LLD: Clean Architecture Compliance](#6-lld-clean-architecture-compliance)
7. [SOLID Principles Analysis](#7-solid-principles-analysis)
8. [Architecture Decision Records (ADRs)](#8-architecture-decision-records-adrs)
9. [Assumptions & External Dependencies](#9-assumptions--external-dependencies)

---

## 1. Service Identity

| Property | Value |
|---|---|
| **Service Name** | signal-probe |
| **Owner Team** | Platform / Signal Analysis |
| **API Version** | `v1` |
| **Base URL** | `http://localhost:8000/api/v1` (dev) |
| **Auth Mechanism** | Bearer JWT (issued by `/api/v1/auth/login`) |
| **Primary Persistence** | SQLite (dev) / PostgreSQL (prod) via SQLAlchemy async |
| **Secondary Persistence** | Local filesystem Parquet files via `IStorageAdapter` |
| **Frontend** | React 19 SPA (Vite + Tailwind v4), served on port 5173 |
| **Feature Scope** | Entirely frontend — backend analysis endpoints unchanged from Feature 6 |

---

## 2. C4 Diagrams

### 2.1 Context Diagram (System Level)

The Context diagram places signal-probe as a whole in its environment. Feature 8 adds no new external systems; it surfaces the existing spectral analysis capability through a richer interactive UI.

```mermaid
C4Context
    title System Context — signal-probe (Feature 8)

    Person(analyst, "Data Scientist", "Uploads CSV signal files, explores STFT parameters interactively, and inspects spectrograms to identify frequency features.")

    System(signalProbe, "signal-probe", "Multi-channel time-series signal ingestion, interactive STFT parameter exploration, and global spectrogram generation platform.")

    System_Ext(fileSystem, "Local File System", "Stores raw uploaded CSV files and processed Parquet artifacts. Accessed via the IStorageAdapter abstraction.")

    System_Ext(db, "Relational Database", "PostgreSQL (prod) / SQLite (dev). Stores signal metadata and run-segment statistics.")

    Rel(analyst, signalProbe, "Uploads signal, brushes time window, locks parameters, generates spectrogram", "HTTPS / Browser")
    Rel(signalProbe, fileSystem, "Reads processed Parquet for STFT computation", "OS I/O")
    Rel(signalProbe, db, "Reads signal ownership and COMPLETED status before analysis", "asyncpg / aiosqlite")
```

---

### 2.2 Container Diagram

Feature 8 adds no new containers. It extends the React SPA with new components that consume two existing FastAPI analysis endpoints.

```mermaid
C4Container
    title Container Diagram — signal-probe (Feature 8)

    Person(analyst, "Data Scientist", "Uses a modern browser")

    Container(spa, "React SPA", "React 19, Vite, Tailwind v4", "Renders the upload wizard, column config panel, multi-channel Plotly charts, AND the new STFT Exploration panel (Feature 8).")

    Container(api, "FastAPI Server", "Python 3.12, FastAPI, Uvicorn", "Exposes REST API v1. Auth, signal CRUD, column inspection, pipeline orchestration, macro/chunk queries, AND spectral analysis endpoints (Feature 6).")

    ContainerDb(db, "Relational DB", "SQLite (dev) / PostgreSQL (prod)", "Stores user accounts, signal_metadata rows, and run_segment rows.")

    ContainerDb(storage, "File Storage", "Local filesystem (IStorageAdapter)", "Holds raw CSVs at signals/{id}/raw.{ext} and processed Parquet at signals/{id}/processed.parquet.")

    Rel(analyst, spa, "Interacts with", "HTTPS")
    Rel(spa, api, "REST calls — including GET /analysis/stft and GET /analysis/spectrogram", "HTTP / fetch")
    Rel(api, db, "Async ORM queries", "SQLAlchemy async")
    Rel(api, storage, "Lazy-scan Parquet for STFT computation", "IStorageAdapter / Polars")
```

---

### 2.3 Component Diagram — Backend API Server

The backend is **unchanged** by Feature 8. This diagram shows the existing analysis components for completeness and to confirm their interfaces are sufficient.

```mermaid
C4Component
    title Component Diagram — Backend API Server (existing, unchanged for Feature 8)

    Container_Boundary(api, "FastAPI Server") {

        Component(analysisRouter, "Analysis Router", "Presentation Layer\n(FastAPI APIRouter)", "GET /{signal_id}/analysis/stft and GET /{signal_id}/analysis/spectrogram. Validates query params, maps exceptions to HTTP status codes.")

        Component(stftSvc, "STFTService", "Application Layer\n(Use-Case Orchestrator)", "Validates ownership + COMPLETED status. Loads Parquet via IStorageAdapter. Infers sampling rate. Delegates computation to the STFT engine.")

        Component(stftEngine, "STFT Engine\n(compute_stft / compute_spectrogram)", "Domain Layer\n(Pure Functions)", "Zero framework dependencies. Accepts NumPy arrays; returns SpectrumResult / SpectrogramResult dataclasses. Fully unit-testable in isolation.")

        Component(schemas, "Analysis Schemas", "Domain Layer\n(Value Objects / DTOs)", "STFTWindowConfig, SpectrogramConfig, STFTResponse, SpectrogramResponse, WindowFunction enum.")

        Component(repo, "SignalRepository", "Infrastructure Layer\n(Repository Pattern)", "Reads SignalMetadata (owner_id, status, channel_names, processed_file_path).")

        Component(storageAdpt, "LocalStorageAdapter", "Infrastructure Layer\n(Ports & Adapters)", "Implements IStorageAdapter. Polars scan_parquet with column projection for memory-efficient STFT reads.")
    }

    ContainerDb(db, "Relational DB", "", "")
    ContainerDb(fs, "File Storage", "", "")

    Rel(analysisRouter, stftSvc, "Delegates to")
    Rel(stftSvc, stftEngine, "Calls compute_stft / compute_spectrogram")
    Rel(stftSvc, schemas, "Constructs STFTWindowConfig / SpectrogramConfig")
    Rel(stftSvc, repo, "Loads signal metadata via")
    Rel(stftSvc, storageAdpt, "Reads processed Parquet via")
    Rel(repo, db, "SQL queries")
    Rel(storageAdpt, fs, "OS I/O (Polars lazy scan)")
```

---

### 2.4 Component Diagram — Frontend SPA (Feature 8)

This diagram shows the new exploration components and their relationships within the React SPA.

```mermaid
C4Component
    title Component Diagram — Frontend SPA — STFT Exploration (Feature 8)

    Container_Boundary(spa, "React SPA") {

        Component(signalsPage, "SignalsPage", "Page\n(React 19)", "Hosts the macro chart and the new STFTExplorerPanel. Owns shared xRange state for synchronized zoom. Conditionally mounts exploration panel for COMPLETED signals.")

        Component(explorerPanel, "STFTExplorerPanel", "Feature Container\n(React component)", "Top-level container for the four-phase exploration workflow. Instantiates useSTFTExplorer; distributes state and action handlers to child components.")

        Component(useExplorer, "useSTFTExplorer", "Custom Hook\n(useReducer + useEffect)", "Single source of truth for the exploration state machine (idle → exploring → locked → generating → spectrogram_ready). Owns debounce logic and AbortController lifecycle.")

        Component(explorationChart, "Exploration Time-Series Chart", "Plotly Scatter\n(dragmode: select)", "Renders the single-channel signal for brush interaction. Fires onRelayout events consumed by useSTFTExplorer.onBrushChange.")

        Component(fftChart, "FFTSpectrumChart", "Plotly Scatter\n(line chart)", "Renders FFT magnitude vs. frequency. Shows dominant frequency annotation. Handles loading/error/stale-dim states.")

        Component(paramControls, "STFTParamControls", "React component", "Window function selector, lock/unlock button, overlap slider with hop_size preview, and Generate Spectrogram button. Progressive disclosure based on phase.")

        Component(spectrogramChart, "SpectrogramChart", "Plotly Heatmap\n(Viridis, WebGL)", "Renders the full-signal spectrogram. Handles exploration brush overlay, t0_epoch_s datetime x-axis, synchronized zoom via onRelayout, downsampled notice.")

        Component(apiLib, "lib/api.ts\n(fetchSTFT / fetchSpectrogram)", "HTTP Client\n(fetch + AbortController)", "Typed wrappers around the two analysis REST endpoints. Accept AbortSignal for cancellation.")
    }

    System_Ext(analysisAPI, "FastAPI Analysis Endpoints", "GET /signals/{id}/analysis/stft\nGET /signals/{id}/analysis/spectrogram")

    Rel(signalsPage, explorerPanel, "Mounts; passes signalId, channelNames, macroData, sharedXRange")
    Rel(explorerPanel, useExplorer, "Instantiates; reads state + calls actions")
    Rel(explorerPanel, explorationChart, "Renders; passes Plotly onRelayout → onBrushChange")
    Rel(explorerPanel, fftChart, "Renders; passes fftResult, loading, error")
    Rel(explorerPanel, paramControls, "Renders; passes phase, locked params, handlers")
    Rel(explorerPanel, spectrogramChart, "Renders; passes spectrogramResult, xRange, brush overlay")
    Rel(useExplorer, apiLib, "Calls fetchSTFT (debounced, with AbortController)")
    Rel(useExplorer, apiLib, "Calls fetchSpectrogram (with AbortController)")
    Rel(apiLib, analysisAPI, "GET requests", "HTTP / fetch")
    Rel(spectrogramChart, signalsPage, "Fires onXRangeChange → setSharedXRange")
    Rel(explorationChart, signalsPage, "Fires onXRangeChange → setSharedXRange")
```

---

## 3. Domain Model: UML Class Diagram

This diagram captures the key types for Feature 8: the frontend value objects, the hook state machine, the component hierarchy, and the API response types consumed from the backend.

```mermaid
classDiagram
    direction TB

    class ExplorationWindow {
        +number start_s
        +number end_s
        +number sampleCount
        +number windowSize
        +nextPowerOfTwo(n: number) number$
    }

    class STFTParams {
        +number windowSize
        +number overlapPct
        +number hopSize
        +WindowFunction windowFn
        +computeHopSize(windowSize, overlapPct) number$
    }

    class ExplorationPhase {
        <<enumeration>>
        idle
        exploring
        locked
        generating
        spectrogram_ready
    }

    class STFTExplorerState {
        +ExplorationPhase phase
        +string|null channel
        +ExplorationWindow|null window
        +STFTResponse|null fftResult
        +boolean fftLoading
        +string|null fftError
        +WindowFunction windowFn
        +number|null lockedWindowSize
        +number overlapPct
        +number hopSize
        +SpectrogramResponse|null spectrogramResult
        +boolean spectrogramLoading
        +string|null spectrogramError
        +number[]|null xRange
    }

    class STFTExplorerActions {
        <<interface>>
        +onBrushChange(start_s, end_s, samplingRate) void
        +onBrushClear() void
        +onWindowFnChange(fn: WindowFunction) void
        +lockWindowSize() void
        +unlockWindowSize() void
        +onOverlapChange(pct: number) void
        +generateSpectrogram() void
        +onXRangeChange(range) void
    }

    class STFTResponse {
        +string signal_id
        +string channel_name
        +number[] frequencies_hz
        +number[] magnitudes
        +number|null dominant_frequency_hz
        +STFTWindowConfig window_config
        +number sampling_rate_hz
    }

    class STFTWindowConfig {
        +number start_s
        +number end_s
        +WindowFunction window_fn
        +number window_size
    }

    class SpectrogramResponse {
        +string signal_id
        +string channel_name
        +number[] time_bins_s
        +number[] frequency_bins_hz
        +number[][] magnitude_db
        +number sampling_rate_hz
        +boolean downsampled
    }

    class WindowFunction {
        <<enumeration>>
        hann
        hamming
        blackman
        bartlett
        flattop
        boxcar
        nuttall
        blackmanharris
    }

    STFTExplorerState --> ExplorationPhase : phase
    STFTExplorerState --> ExplorationWindow : window
    STFTExplorerState --> STFTParams : lockedWindowSize + overlapPct + hopSize
    STFTExplorerState --> STFTResponse : fftResult
    STFTExplorerState --> SpectrogramResponse : spectrogramResult
    STFTExplorerState --> WindowFunction : windowFn
    STFTResponse --> STFTWindowConfig : window_config
    STFTWindowConfig --> WindowFunction : window_fn
    STFTExplorerActions ..> STFTExplorerState : mutates via dispatch
    ExplorationWindow ..> STFTParams : windowSize feeds into
```

---

## 4. Interaction Design: UML Sequence Diagrams

### 4.1 Brush Exploration → Live FFT Flow

This sequence covers the debounced FFT request lifecycle from brush drag to spectrum render, including the AbortController cancellation guard.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Chart as Exploration Chart<br/>(Plotly)
    participant Hook as useSTFTExplorer
    participant Debounce as Debounce Timer<br/>(300 ms)
    participant API as lib/api.ts<br/>fetchSTFT
    participant Backend as FastAPI<br/>/analysis/stft

    User->>Chart: Drag brush over [t1, t2]
    Chart->>Hook: onRelayout({ xaxis.range: [t1, t2] })
    Hook->>Hook: Compute sampleCount = (t2-t1) × samplingRateHz
    Hook->>Hook: windowSize = nextPowerOfTwo(sampleCount)

    alt sampleCount < 4
        Hook->>Chart: Set fftError = "Selection too short"
        Note over Hook: No API call dispatched
    else sampleCount ≥ 4
        Hook->>Hook: Set phase = exploring, window = {t1,t2,windowSize}
        Hook->>Debounce: Reset timer (cancel previous)

        User->>Chart: Resizes brush again (within 300 ms)
        Chart->>Hook: onRelayout (new range)
        Hook->>Debounce: Reset timer again

        Debounce->>Hook: 300 ms quiet period elapsed
        Hook->>Hook: Abort previous AbortController (if in-flight)
        Hook->>Hook: Create new AbortController
        Hook->>Hook: Set fftLoading = true
        Hook->>API: fetchSTFT(signalId, channel, window, windowFn, abortSignal)
        API->>Backend: GET /signals/{id}/analysis/stft?start_s=t1&end_s=t2&window_size=N&window_fn=hann

        alt Success 200
            Backend-->>API: STFTResponse { frequencies_hz, magnitudes, dominant_frequency_hz, sampling_rate_hz }
            API-->>Hook: STFTResponse
            Hook->>Hook: Set fftResult, fftLoading = false
            Hook->>Chart: FFTSpectrumChart re-renders with new spectrum
        else Error (4xx / 5xx)
            Backend-->>API: Error response
            API-->>Hook: throw ApiError
            Hook->>Hook: Set fftError = message, fftLoading = false
        else Aborted (superseded)
            API-->>Hook: AbortError (silently ignored)
        end
    end
```

---

### 4.2 Window Lock & Overlap Configuration Flow

This is a purely local state transition; no API calls are made.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Controls as STFTParamControls
    participant Hook as useSTFTExplorer

    Note over User,Hook: Precondition: fftResult is populated (phase = exploring)

    User->>Controls: Clicks "Lock Window Size"
    Controls->>Hook: lockWindowSize()
    Hook->>Hook: lockedWindowSize = fftResult.window_config.window_size
    Hook->>Hook: hopSize = max(1, round(lockedWindowSize × (1 - overlapPct/100)))
    Hook->>Hook: phase = locked
    Controls->>Controls: Show "Locked ✓ N samples" + "Unlock" button
    Controls->>Controls: Enable overlap slider
    Controls->>Controls: Enable "Generate Spectrogram" button

    User->>Controls: Moves overlap slider to 75%
    Controls->>Hook: onOverlapChange(75)
    Hook->>Hook: overlapPct = 75
    Hook->>Hook: hopSize = max(1, round(lockedWindowSize × 0.25))
    Hook->>Hook: nWindows = floor((signalLengthSamples - lockedWindowSize) / hopSize) + 1
    Controls->>Controls: Update hop_size label + "~N windows" preview

    User->>Controls: Clicks "Unlock"
    Controls->>Hook: unlockWindowSize()
    Hook->>Hook: lockedWindowSize = null, phase = exploring
    Controls->>Controls: Disable overlap slider and Generate button
    Controls->>Controls: Show "Lock Window Size" button
```

---

### 4.3 Spectrogram Generation & Render Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Controls as STFTParamControls
    participant Hook as useSTFTExplorer
    participant API as lib/api.ts<br/>fetchSpectrogram
    participant Backend as FastAPI<br/>/analysis/spectrogram
    participant Spectrogram as SpectrogramChart

    Note over User,Hook: Precondition: phase = locked, lockedWindowSize and hopSize set

    User->>Controls: Clicks "Generate Spectrogram"
    Controls->>Hook: generateSpectrogram()
    Hook->>Hook: Abort previous spectrogram AbortController (if any)
    Hook->>Hook: Create new AbortController
    Hook->>Hook: phase = generating, spectrogramLoading = true
    Spectrogram->>Spectrogram: Render loading skeleton "Computing spectrogram…"
    Controls->>Controls: Disable Generate button, show spinner

    Hook->>API: fetchSpectrogram(signalId, channel, windowSize, hopSize, windowFn, abortSignal)
    API->>Backend: GET /signals/{id}/analysis/spectrogram?channel_name=X&window_size=N&hop_size=H&window_fn=hann

    alt Success 200
        Backend-->>API: SpectrogramResponse { time_bins_s, frequency_bins_hz, magnitude_db, downsampled }
        API-->>Hook: SpectrogramResponse
        Hook->>Hook: spectrogramResult = response, phase = spectrogram_ready
        Hook->>Hook: spectrogramLoading = false
        Spectrogram->>Spectrogram: Render Plotly heatmap (Viridis, dBFS colorbar)
        alt downsampled === true
            Spectrogram->>Spectrogram: Show "⚠ Time axis downsampled to 2 000 bins" notice
        end
        Controls->>Controls: Re-enable Generate button (for re-generation)

    else HTTP 413 (payload too large)
        Backend-->>API: 413 + error detail
        API-->>Hook: throw ApiError(413, message)
        Hook->>Hook: spectrogramError = "Spectrogram too large — try increasing the overlap..."
        Hook->>Hook: phase = locked, spectrogramLoading = false
        Spectrogram->>Spectrogram: Show error banner

    else HTTP 422 (signal too short)
        Backend-->>API: 422 + error detail
        API-->>Hook: throw ApiError(422, message)
        Hook->>Hook: spectrogramError = "Signal is too short for the selected window size..."
        Hook->>Hook: phase = locked, spectrogramLoading = false
        Spectrogram->>Spectrogram: Show error banner
    end
```

---

### 4.4 Synchronized X-Axis Zoom Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Spectrogram as SpectrogramChart
    participant Page as SignalsPage
    participant MacroChart as MultiChannelMacroChart
    participant ExplChart as Exploration Chart

    Note over User,ExplChart: All three Plotly charts share xRange via SignalsPage state

    User->>Spectrogram: Zoom (drag x-axis range to [ta, tb])
    Spectrogram->>Spectrogram: Plotly fires onRelayout({ xaxis.range[0]: ta, xaxis.range[1]: tb })
    Spectrogram->>Page: onXRangeChange([ta, tb])
    Page->>Page: setSharedXRange([ta, tb])

    Page->>MacroChart: Re-render with layout.xaxis.range = [ta, tb]
    MacroChart->>MacroChart: Plotly updates x-axis range (uirevision prevents full re-init)

    Page->>ExplChart: Re-render with layout.xaxis.range = [ta, tb]
    ExplChart->>ExplChart: Plotly updates x-axis range

    Note over User,ExplChart: User now sees all three charts zoomed to [ta, tb]

    User->>Page: Clicks "Reset Zoom"
    Page->>Page: setSharedXRange(null)
    Page->>MacroChart: layout.xaxis.range = undefined (Plotly auto-range)
    Page->>ExplChart: layout.xaxis.range = undefined
    Page->>Spectrogram: layout.xaxis.range = undefined
```

---

## 5. REST API Contracts

Both endpoints were introduced in Feature 6. Feature 8 consumes them without modification.

### 5.1 GET /signals/{signal_id}/analysis/stft

- **Purpose:** Compute the one-sided FFT magnitude spectrum for a user-defined time window.
- **Authentication:** Bearer JWT (required)
- **Path Parameter:** `signal_id` — UUID of the target signal.

**Query Parameters:**

| Parameter | Type | Required | Default | Constraint |
|---|---|---|---|---|
| `channel_name` | string | ✓ | — | Must exist in `signal_metadata.channel_names` |
| `start_s` | float | ✓ | — | ≥ 0 |
| `end_s` | float | ✓ | — | > `start_s` |
| `window_fn` | enum | — | `hann` | See `WindowFunction` enum |
| `window_size` | int | — | `1024` | Power of 2; range [4, 131 072] |

**Success Response `200 OK`:**
```json
{
  "signal_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "channel_name": "sensor_a",
  "frequencies_hz": [0.0, 0.976, 1.953],
  "magnitudes": [0.002, 0.845, 0.234],
  "dominant_frequency_hz": 12.207,
  "window_config": {
    "start_s": 1.0,
    "end_s": 2.024,
    "window_fn": "hann",
    "window_size": 1024
  },
  "sampling_rate_hz": 1000.0
}
```

**Error Responses:**

| Status | Condition |
|---|---|
| `401` | Missing or invalid JWT |
| `404` | Signal or channel not found |
| `409` | Signal status is not `COMPLETED` |
| `422` | Invalid query params (window_size not power-of-2; start_s ≥ end_s; signal segment too short) |

---

### 5.2 GET /signals/{signal_id}/analysis/spectrogram

- **Purpose:** Compute the full-signal sliding-window STFT spectrogram in dBFS.
- **Authentication:** Bearer JWT (required)
- **Path Parameter:** `signal_id` — UUID of the target signal.

**Query Parameters:**

| Parameter | Type | Required | Default | Constraint |
|---|---|---|---|---|
| `channel_name` | string | ✓ | — | Must exist in `signal_metadata.channel_names` |
| `window_fn` | enum | — | `hann` | See `WindowFunction` enum |
| `window_size` | int | — | `1024` | Power of 2; range [4, 131 072] |
| `hop_size` | int | — | `512` | ≥ 1; must be ≤ `window_size` |

**Success Response `200 OK`:**
```json
{
  "signal_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "channel_name": "sensor_a",
  "time_bins_s": [0.512, 1.024, 1.536],
  "frequency_bins_hz": [0.0, 0.976, 1.953],
  "magnitude_db": [[-80.2, -72.1, -65.3], [-78.4, -71.0, -66.8]],
  "sampling_rate_hz": 1000.0,
  "downsampled": false
}
```

**Error Responses:**

| Status | Condition |
|---|---|
| `401` | Missing or invalid JWT |
| `404` | Signal or channel not found |
| `409` | Signal status is not `COMPLETED` |
| `413` | Spectrogram matrix exceeds `STFT_MAX_RESPONSE_MB` limit |
| `422` | Invalid params or signal shorter than `window_size` |

---

## 6. LLD: Clean Architecture Compliance

Feature 8 adds exclusively frontend components. The analysis below verifies that the new frontend code respects Clean Architecture boundaries, and confirms the backend is untouched.

### 6.1 Backend (unchanged)

The existing backend already conforms to Clean Architecture as established in Feature 6:

| Layer | Module | Dependency Rule Compliance |
|---|---|---|
| Domain | `stft_engine.py`, `domain/analysis/schemas.py` | Zero framework imports ✓ |
| Application | `stft_service.py` | Depends only on domain abstractions + `IStorageAdapter` interface ✓ |
| Infrastructure | `LocalStorageAdapter`, `SignalRepository` | Implements domain interfaces; no domain layer imports ✓ |
| Presentation | `endpoints/analysis.py` | Translates HTTP ↔ Use Case; catches typed exceptions and maps to HTTP codes ✓ |

### 6.2 Frontend (new — Feature 8)

Although the frontend does not use the same strict layering as a backend server, the same dependency-inversion and separation-of-concerns principles are applied:

| Concern | Location | Clean Architecture Analogue |
|---|---|---|
| **Business rules** (power-of-2 window, hop_size formula, phase transitions) | `useSTFTExplorer.ts` | Domain / Application layer — zero UI framework imports in the pure logic functions |
| **Use-case orchestration** (debounce, AbortController, error mapping) | `useSTFTExplorer.ts` | Application layer — orchestrates async side-effects, delegates HTTP calls to `api.ts` |
| **I/O adapter** (HTTP fetch, error deserialization) | `lib/api.ts` | Infrastructure layer — all `fetch()` calls isolated here; easy to mock in tests |
| **Presentation** (layout, Plotly config, accessibility) | `STFTExplorerPanel.tsx`, `FFTSpectrumChart.tsx`, `SpectrogramChart.tsx`, `STFTParamControls.tsx` | Presentation layer — purely renders state; no business logic |

**Dependency direction is enforced:**
- Presentation components receive state and actions via props; they do **not** import `lib/api.ts` directly.
- `useSTFTExplorer` imports `lib/api.ts` but does **not** import Plotly or any React UI component.
- `lib/api.ts` imports nothing from the hook or components layer.

### 6.3 Error Handling Boundary

Following the LLD error-handling standard, errors are raised and propagated upward, then mapped at the boundary:

```
lib/api.ts            → throws ApiError(status, message)
useSTFTExplorer       → catches ApiError; maps to { fftError | spectrogramError } state string
                       (AbortError is silently discarded — not a real failure)
FFTSpectrumChart      → renders error banner from props.error
SpectrogramChart      → renders error banner from props.error
```

No raw error messages or stack traces reach the user. Error strings are user-safe and actionable (e.g., "Spectrogram too large — try increasing the overlap").

---

## 7. SOLID Principles Analysis

### S — Single Responsibility Principle

| Component | Single Responsibility |
|---|---|
| `useSTFTExplorer` | Owns the exploration state machine, debounce, and async side-effects — nothing else |
| `FFTSpectrumChart` | Renders the FFT spectrum; knows nothing about how the data was fetched |
| `SpectrogramChart` | Renders the spectrogram heatmap and synchronized zoom; no STFT business logic |
| `STFTParamControls` | Renders and dispatches parameter UI interactions; no computation |
| `lib/api.ts` (`fetchSTFT`, `fetchSpectrogram`) | HTTP transport only; no state or UI concerns |

### O — Open/Closed Principle

- `STFTExplorerPanel` is closed to modification but open for extension: adding a new visualization panel (e.g., a phase-spectrum view) requires only a new child component and a new hook state field — no changes to existing components.
- `WindowFunction` is a TypeScript string union mirroring the backend `StrEnum`. Adding a new window function requires only adding it to both enums — no switch statements to modify.

### L — Liskov Substitution Principle

- `fetchSTFT` and `fetchSpectrogram` both return `Promise<T>` and accept an optional `AbortSignal`. Any future mock implementation used in tests is fully substitutable — the hook is unaware whether it is talking to a real server or a stub.

### I — Interface Segregation Principle

- `STFTParamControlsProps` does not expose hook internals (e.g., the raw `AbortController` or the dispatch function). It receives only the minimal set of values and callbacks it actually renders, preventing tight coupling to the hook's internal implementation.
- `SpectrogramChartProps` does not include FFT-specific data; it only receives `SpectrogramResponse` and zoom state. This prevents the spectrogram component from depending on the exploration phase.

### D — Dependency Inversion Principle

- `useSTFTExplorer` depends on the `fetchSTFT` / `fetchSpectrogram` function signatures (abstractions), not on `fetch()` directly. In tests, these functions can be replaced with mocks passed as parameters (or mocked via Jest/MSW) without modifying the hook.
- `STFTExplorerPanel` depends on the `useSTFTExplorer` return type (an interface), not on its internal implementation. The hook could be replaced with a different implementation (e.g., one that caches results) without changing any component.

---

## 8. Architecture Decision Records (ADRs)

### ADR-1: Feature 8 is Frontend-Only — No Backend Changes

| Field | Detail |
|---|---|
| **Status** | Accepted |
| **Context** | Feature 8 requires live FFT preview and full spectrogram generation. Both computations were already implemented in Feature 6 via `GET /signals/{id}/analysis/stft` and `GET /signals/{id}/analysis/spectrogram`. |
| **Decision** | Implement Feature 8 exclusively in the React SPA. The two existing analysis endpoints are consumed as-is without modification. |
| **Rationale** | Avoids deployment coupling between frontend and backend. Reduces blast radius — a frontend-only PR cannot break the backend pipeline or database migrations. |
| **Consequences** | Frontend must handle all UX state (phase machine, debounce, abort). Backend endpoints must remain backward-compatible if their signatures change in future features. |
| **Rejected Alternative** | A dedicated "exploration session" backend endpoint that caches partial STFT results for faster re-queries — rejected as premature optimization given the current single-user scope. |

---

### ADR-2: Debounce (300 ms) Over Throttle for Brush Interactions

| Field | Detail |
|---|---|
| **Status** | Accepted |
| **Context** | The brush can fire dozens of `onRelayout` events per second during a drag. Naively calling the FFT API on every event would cause hundreds of redundant in-flight requests. |
| **Decision** | Apply a **debounce** of 300 ms: the API call fires only after the user stops dragging for 300 ms. Each new drag event resets the timer. |
| **Rationale** | Debounce fires *after* user intent is resolved (brush drag complete), producing a single meaningful API call per gesture. Throttle would fire at a fixed rate *during* dragging, often with intermediate, irrelevant window positions — wasting compute and producing a jarring spectrum update mid-gesture. |
| **Consequences** | There is a 300 ms perceived lag between stopping the drag and seeing the spectrum update. This is acceptable per the SRS NFR: "maintaining a fluid user experience with acceptable latency." |
| **Rejected Alternative** | Throttle at 500 ms — fires too frequently during fast drags and doesn't guarantee firing after the gesture is complete. |

---

### ADR-3: AbortController for In-Flight Request Cancellation

| Field | Detail |
|---|---|
| **Status** | Accepted |
| **Context** | A new brush event can arrive before the previous FFT response returns. Without cancellation, stale responses can overwrite newer spectrum renders (race condition). |
| **Decision** | Maintain one `AbortController` per request type (FFT, spectrogram). Before dispatching a new request, call `abort()` on the previous controller. Ignore `AbortError` in the catch block. |
| **Rationale** | The Web Fetch API's `AbortController` is the standard, zero-dependency mechanism for request cancellation in modern browsers. It cancels the underlying TCP connection, saving backend resources. |
| **Consequences** | Backend may occasionally receive a request that is cancelled mid-flight; FastAPI handles this via `asyncio.CancelledError` without side effects (analysis endpoints are read-only). |
| **Rejected Alternative** | Request-ID version counter (ignore responses whose request_id < current_id) — works but doesn't cancel the in-flight network request, wasting bandwidth. |

---

### ADR-4: `useReducer` State Machine Over Multiple `useState` Calls

| Field | Detail |
|---|---|
| **Status** | Accepted |
| **Context** | The exploration workflow has 5 phases with strict transition rules. Implementing this with multiple independent `useState` calls risks partial state updates (e.g., `fftLoading = true` without `phase = exploring`) causing inconsistent renders. |
| **Decision** | Use React `useReducer` with a typed `Action` union. Each action type produces an atomic state transition. The `phase` field is the single source of truth for workflow position. |
| **Rationale** | `useReducer` guarantees atomic state transitions — the reducer runs synchronously and returns the next complete state. This eliminates the class of "partially updated state" bugs that arise with multiple `useState` calls during async operations. The typed action union also makes the valid transition table self-documenting. |
| **Consequences** | Slightly more boilerplate than `useState`. Requires a well-defined `ExplorationAction` union type. Worth the investment given the 5-phase state machine complexity. |
| **Rejected Alternative** | Zustand global store — unnecessary for component-local exploration state; introduces a new dependency. |

---

### ADR-5: Viridis Colorscale for Spectrogram

| Field | Detail |
|---|---|
| **Status** | Accepted |
| **Context** | A colorscale must be chosen for the spectrogram heatmap. Common choices are Jet, Hot, Inferno, Viridis. |
| **Decision** | **Viridis** is mandatory. `Jet` is explicitly forbidden. |
| **Rationale** | Viridis is perceptually uniform (equal perceived distance per dBFS unit), colorblind-safe (deuteranopia/protanopia friendly), and reproduces correctly in grayscale printing. `Jet` has severe perceptual non-uniformity — its rainbow bands create false visual features (phantom peaks) in the spectrogram that mislead analysts. This is a direct violation of the project's scientific visualization policy. |
| **Consequences** | All SpectrogramChart renders must hardcode `colorscale: 'Viridis'`. A future user preference for colorscale is deferred. |
| **Rejected Alternative** | Inferno — perceptually uniform and accessible, but lacks the intuitive low→high energy mapping (dark→light) that Viridis provides. Deferred as a future user preference. |

---

### ADR-6: window_size = Next Power of 2 ≥ Brush Sample Count

| Field | Detail |
|---|---|
| **Status** | Accepted |
| **Context** | The FFT algorithm (`numpy.fft.rfft`) is most efficient on power-of-2 input lengths. The brush gives an arbitrary sample count; the backend's `window_size` parameter must be a power of 2. |
| **Decision** | The frontend computes `windowSize = nextPowerOfTwo(sampleCount)`, capped at 131 072. This derived value is displayed to the user and sent to the backend. |
| **Rationale** | Zero-padding to the next power of 2 is standard practice in DSP. It avoids forcing users to manually calculate powers of 2 from their brush selection, reducing cognitive load. The derived window_size is always ≥ the actual segment length, so the full segment is always included (the excess is zero-padded by the backend engine). |
| **Consequences** | The effective frequency resolution is `sampling_rate_hz / windowSize` (based on the padded size), which may be slightly finer than the "natural" resolution of the brush selection. This is explained in the FFT panel header. |
| **Rejected Alternative** | Truncate to the largest power of 2 ≤ sampleCount — discards data at the end of the brush region; worse for users who need to capture a specific endpoint. |

---

## 9. Assumptions & External Dependencies

| # | Type | Description | Risk | Fallback Strategy |
|---|---|---|---|---|
| 1 | Assumption | The signal has `COMPLETED` status and a valid processed Parquet file before the exploration view is accessible. | — | The `STFTExplorerPanel` checks signal status and renders a disabled placeholder for non-COMPLETED signals. |
| 2 | Assumption | The processed Parquet `timestamp_s` column is monotonically increasing with near-uniform spacing, enabling reliable `sampling_rate_hz` inference via median inter-sample interval. | — | The backend `_infer_sampling_rate` raises `ValueError` for non-positive median dt; the endpoint returns 422 with an actionable message. |
| 3 | Assumption | The frontend always receives a valid `sampling_rate_hz` from `STFTResponse` before the user locks the window size. This is needed to compute `n_windows` preview. | Low | If no FFT has been fetched yet, the `n_windows` preview is hidden ("Lock a window first"). |
| 4 | Ext. Dependency | **Plotly.js** — brush selection (`dragmode: 'select'`), heatmap trace type, `onRelayout` event, WebGL acceleration. | Medium | Plotly.js is already bundled (`plotly-dist-min`). Heatmap and Scatter trace types are included. No new bundle import required. If Plotly's WebGL path fails (older browser), canvas fallback is automatic. |
| 5 | Ext. Dependency | **FastAPI analysis endpoints** — `GET /analysis/stft` and `GET /analysis/spectrogram` — must remain available and backward-compatible. | Low | Endpoints are read-only and already stable since Feature 6. If they become unavailable, all error states are handled gracefully in the hook with actionable error messages. |
| 6 | Ext. Dependency | **STFT_MAX_RESPONSE_MB** environment variable — caps spectrogram payload size. Default: 50 MB. | Medium | HTTP 413 is handled with a user-friendly error message instructing the user to increase overlap or reduce window size. No crash or unhandled state. |
| 7 | Assumption | The browser supports the `AbortController` API (all modern browsers, available since Chrome 66, Firefox 57, Safari 11.1). | Low | Signal-probe targets modern browsers; no polyfill required. |
