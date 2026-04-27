# Signal Probe — Engineering Handbook

**Document Status:** Approved & Baseline
**Product Name:** Signal Probe — Time-Series Signal Intelligent Exploration Engineering Platform

---

## 1. Product Overview & Motivation

- **Product Vision:** Eliminate the "getting lost" feeling for data scientists and process engineers when navigating massive machine time-series data. By automating feature extraction and leveraging a Macro-Micro visualization architecture, the platform transforms long-cycle raw signals into instantly comparable micro-engineering insights, significantly accelerating anomaly root-cause analysis.
- **Target Audience:** Data Scientists, Data Engineers, Equipment Engineers, and Process Engineers.
- **Design Philosophy:** Precision, strict typing, high-performance rendering, and scientific visual standards (no chart junk).

---

## 2. Core User Stories

| ID | As a… | I want to… | So that… |
|----|-------|-----------|---------|
| **US-1** | Data Scientist | Upload months of machine signals and auto-filter idle time | I can focus exclusively on Active working cycles without dilution from noise |
| **US-2** | Process Engineer | View 10 auto-segmented run cycles side-by-side (Small Multiples) | I can visually align and compare OOC anomaly positions across runs |
| **US-3** | System Architect | Enforce strict data contracts between frontend and backend | The frontend never processes unexpected or dirty data structures |

---

## 3. Functional Requirements

### 3.1 Signal Processing & Tagging Pipeline
- **FR-1.1** Automatically tag all time-series data as `IDLE`, `ACTIVE`, or `OOC` using rolling variance / moving average algorithms.
- **FR-1.2** Encapsulate continuous `ACTIVE` blocks into independent "Runs", each with a unique `run_id`.
- **FR-1.3** Pre-calculate and store per-run aggregated features: duration, max, min, variance, OOC count.

### 3.2 Macro Timeline Navigation
- **FR-2.1** Global trend chart returns **all original data points** at full resolution (LTTB downsampling was removed — see ADR-004). Run-bound rectangles overlay `ACTIVE`/`OOC` state regions.
- **FR-2.2** When the time column is a temporal datetime type, the x-axis displays absolute calendar dates/times; otherwise elapsed seconds are shown.
- **FR-2.3** Draggable brush tool selects a time range and dynamically updates the Micro Grid below. For datetime axes the brush range is converted back from ISO strings to elapsed seconds before filtering run bounds.

### 3.3 Micro Feature Grid (Small Multiples)
- **FR-3.1** Dynamically generate a matrix of independent charts for each Run in the selected range.
- **FR-3.2** Y-axis auto-adapts per chart; X-axis supports "Relative Time" or "Progress Percentage" alignment.
- **FR-3.3** Hovering over any chart synchronously renders a crosshair at the same relative X position across all charts.

### 3.4 STFT Parameter Exploration
- **FR-4.1** The Dashboard exposes a collapsible **STFT Explorer** panel for any COMPLETED signal. The user selects a channel, then brushes a time window on the Macro Timeline to trigger an FFT spectrum computation.
- **FR-4.2** The FFT magnitude spectrum (`GET /signals/{id}/analysis/stft`) is computed for the brushed window and rendered as a bar/line Plotly chart. The dominant frequency is highlighted. Adaptive y-axis labels switch between Hz / kHz automatically.
- **FR-4.3** The user can lock the window size and configure overlap percentage (0–95 %), then trigger a full sliding-window spectrogram (`GET /signals/{id}/analysis/spectrogram`).
- **FR-4.4** The spectrogram is rendered as a Plotly heatmap (time × frequency, dBFS colour scale). When the signal uses an absolute datetime axis the spectrogram x-axis is converted to ISO date strings using `t0_epoch_s`.
- **FR-4.5** The backend offloads FFT work to a `ProcessPoolExecutor` (see ADR-010). The spectrogram time axis is capped at 2,000 bins via pre-selection downsampling before any FFT is performed.

---

## 4. System Architecture

```text
=========================================================================================
                                SIGNAL PROBE - SYSTEM ARCHITECTURE
=========================================================================================

  [ USER / DATA SCIENTIST / PROCESS ENGINEER ]
       |
       | (HTTPS / WebSocket)
       v
+---------------------------------------------------------------------------------------+
|                                 FRONTEND (React 19 + TypeScript)                      |
|                                                                                       |
|  +-------------------------+    +--------------------------------------------------+  |
|  |     UI COMPONENTS       |    |            VISUALIZATION ENGINE (Plotly.js)      |  |
|  |                         |    |                                                  |  |
|  | - Auth Pages            |    |  +--------------------+  +--------------------+  |  |
|  | - Dashboard Layout      |====|  |  Macro Timeline    |  |  Micro Grid        |  |  |
|  | - File Uploader         |    |  |  (Full Resolution) |  |  (Small Multiples) |  |  |
|  | - Brush/Selection Tool  |    |  |  (Brush Tool)      |  |  (Sync Crosshairs) |  |  |
|  +-------------------------+    +--------------------------------------------------+  |
|             |                                    ^ WebGL / Canvas Rendering            |
|             v                                    |                                     |
|  +-------------------------+                     |                                     |
|  |    STATE MANAGEMENT     |=====================+                                     |
|  | - AuthContext (JWT)     |                                                           |
|  | - React Router          |                                                           |
|  | - API Client (Axios)    |                                                           |
|  +-------------------------+                                                           |
+---------------------------------------------------------------------------------------+
       |                  ^
       | (REST API / JWT) | (JSON / Pydantic Schemas)
       v                  |
+---------------------------------------------------------------------------------------+
|                                 BACKEND (FastAPI + Python 3.12)                       |
|                                                                                       |
|  [ PRESENTATION LAYER ]  /api/v1/auth  ·  /api/v1/signals                            |
|             |                                                                         |
|             v                                                                         |
|  [ APPLICATION LAYER ]   UserService  ·  SignalService  ·  PipelineOrchestrator      |
|             |                                                                         |
|             v                                                                         |
|  [ DOMAIN LAYER ]        Models (User, SignalMetadata, RunSegment)                    |
|                          Schemas / Enums (IDLE, ACTIVE, OOC)                          |
|                          Algorithms (LTTB, RollingVariance, RunSegmentation)          |
|             |                                                                         |
|             v                                                                         |
|  [ INFRASTRUCTURE LAYER ] UserRepository · SignalRepository (SQLAlchemy Async)       |
|                            StorageAdapter (Local / MinIO)  ·  SecurityAdapter        |
+---------------------------------------------------------------------------------------+
       |                  ^
       | (AsyncPG / SQL)  |         (File Stream / MinIO / AWS S3)
       v                  |
+---------------------------------------------------------------------------------------+
|  PostgreSQL: users · signal_metadata · run_segments                                   |
|  Blob Storage: raw_signals.csv/.parquet · processed_chunks.parquet                    |
+---------------------------------------------------------------------------------------+
```

- **Column-Config UI (`ColumnConfigPanel`, `useColumnConfig` hook):**
  - Wide format: `TimeColumnSelector` (radio group) + `SignalColumnSelector` (checkbox group) + optional `UnitColumnSelector`.
  - Stacked format: `DatetimeColumnSelector` (radio group, temporal columns only, auto-selects best candidate) + `StackedChannelPicker` (checkbox group) + optional `UnitColumnSelector`.
  - `UnitColumnSelector` is a radio group offering `(none)` plus any string-dtype columns not already assigned to time/signal roles. It is hidden when no eligible columns exist.
  - State is managed by `useReducer` inside `useColumnConfig`. `canSubmit` for stacked format additionally requires `datetimeCol !== null`.

- **STFT Explorer (`STFTExplorerPanel`, `useSTFTExplorer` hook):**
  - Collapsible panel rendered below the Macro Timeline in `Dashboard.tsx` for any COMPLETED signal.
  - `useSTFTExplorer` is a `useReducer`-based state machine with phases: `idle → exploring → locked → generating → spectrogram_ready`. Debounces FFT requests (300 ms) and cancels in-flight requests via `AbortController` on channel change or brush clear.
  - `STFTParamControls`: window function selector (15 options), overlap % slider (0–95), lock/unlock button, "Generate Spectrogram" button. Disabled states are enforced per phase.
  - `FFTSpectrumChart`: Plotly bar chart of the FFT magnitude spectrum. Highlights the dominant frequency. Y-axis label adapts between Hz and kHz automatically.
  - `SpectrogramChart`: Plotly heatmap (time × frequency bins, dBFS). When `t0_epoch_s` is set, time bins are converted to ISO date strings so the x-axis aligns with the Macro Timeline. Displays a `downsampled` badge when the backend has pre-selected 2,000 time bins.

- **UI & State:** React components manage layout, forms, and tools. `AuthContext` handles global JWT state via React Context API.
- **Visualization Engine (Plotly.js):**
  - **WebGL Rendering:** Bypasses the DOM and renders directly to GPU canvas — essential for 60 FPS on dense time-series.
  - **Macro Timeline:** Full-resolution global view (all original data points) with a Brush tool for time-range selection. When `t0_epoch_s` is set, the x-axis shows absolute datetime; otherwise elapsed seconds.
  - **Multi-channel Stacked Chart (`MultiChannelMacroChart`):** When a signal has >1 channel, each channel is rendered in its own horizontal subplot row sharing a single x-axis. Per-panel title annotations and run-bound rectangles are composited. All rendering is fully memoized — `channels`, `xValues`, `domains`, `traces`, and `layout` are each wrapped in `useMemo`/`useCallback`.
  - **Micro Grid (`MicroChart`):** Dynamic grid of Plotly instances (one per Run) with synchronized crosshairs. Component lives in `src/components/MicroChart.tsx`.
- **Scientific Visual Standards:** Monospace typography for axes, high-contrast deep-red markers for OOC points, no decorative chart junk.
- **Chart Theme (`src/lib/chartTheme.ts`):** `buildChartTheme(theme)` returns a Plotly partial layout config matching the active UI theme. `LIGHT_AXIS` and `DARK_AXIS` both include `showgrid: true` and `griddash: 'dash'`. Use this as the base for every chart layout — never inline color constants directly.

### 4.2 Backend — Domain-Driven Design (DDD) Layers

| Layer | Responsibility | Key Rule |
|-------|---------------|----------|
| **Presentation** | FastAPI routers, Pydantic request/response validation | Never contains business logic |
| **Application** | Use-case orchestration (`SignalService`, `PipelineOrchestrator`, `STFTService`) | Depends only on Domain interfaces (DIP) |
| **Domain** | Entities, enums, algorithms — pure Python, zero framework imports | No imports from outer layers; `domain/signal/` and `domain/analysis/` sub-packages |
| **Infrastructure** | SQLAlchemy repositories, storage adapters, security (bcrypt/JWT), `ProcessPoolExecutor` | Implements interfaces defined by inner layers |

**Spectral Analysis bounded context** (`domain/analysis/`, `application/analysis/`):
- `domain/analysis/schemas.py` — Pydantic v2 value objects: `STFTWindowConfig`, `SpectrogramConfig`, `WindowFunction` (StrEnum, 15 values), `STFTResponse`, `SpectrogramResponse`. Zero framework imports.
- `domain/analysis/stft_engine.py` — Pure NumPy/SciPy computation: `compute_stft()` (single window FFT), `compute_spectrogram()` (sliding-window spectrogram with pre-selection optimisation and vectorised frame matrix). Designed for `ProcessPoolExecutor` dispatch.
- `application/analysis/stft_service.py` — `STFTService`: validates ownership/status, reads Parquet via Polars column projection, infers sampling rate from median inter-sample interval, dispatches to `ProcessPoolExecutor`, enforces payload size cap (`STFT_MAX_RESPONSE_MB`, default 50 MB).
- `infrastructure/executor.py` — `ProcessPoolExecutor` lifecycle: `start_executor()` / `stop_executor()` called from FastAPI lifespan; `get_executor()` returns the running executor. Workers pre-warm NumPy/SciPy imports at startup. Worker count controlled by `ANALYSIS_WORKERS` env var (default: `max(2, cpu_count)`).

### 4.4 Error Handling Architecture

All backend errors are handled through a centralized, layered pattern. The hierarchy lives in `app/core/exceptions.py`; all HTTP mapping lives in `app/main.py`. No framework imports (FastAPI, Starlette) in the domain or application layers.

```
app/core/exceptions.py
│
├── DomainException (base)           ← no FastAPI/HTTP import
│   ├── NotFoundException            → 404  (resource not found)
│   ├── ConflictException            → 409  (wrong state, duplicate)
│   └── ValidationException          → 422  (bad input, unknown column)
│
└── InfrastructureException          → 500  (DB / storage fault, logged)
```

**Who raises what:**

| Layer | What it raises | What it catches |
|-------|---------------|-----------------|
| Application services | `NotFoundException`, `ConflictException`, `ValidationException` | nothing |
| Repositories (DB) | `ConflictException` (IntegrityError), `InfrastructureException` (SQLAlchemyError + rollback) | `IntegrityError`, `SQLAlchemyError` |
| Storage adapter | `ValidationException` (path traversal), `InfrastructureException` (OSError) | `OSError`, `FileNotFoundError` |
| Presentation endpoints | — (no try/except for domain errors) | — |
| `app/main.py` handlers | — | all of the above → HTTP response |

**Client response envelope (all errors):**
```json
{ "error": { "code": "NOT_FOUND", "message": "Signal not found", "timestamp": "ISO8601" } }
```

**Infrastructure errors** are logged server-side with full traceback (`logger.exception`) but the client always receives a safe generic message (no paths or stack traces).



- **PostgreSQL** stores relational metadata: user accounts, signal job status, and per-run aggregated statistics (duration, max, min, variance, OOC count).
- **Blob/File Storage** stores raw and processed time-series data as `.parquet` / `.csv` files. This keeps PostgreSQL lean and enables 10–100× faster columnar reads via Polars/Pandas compared to row-based SQL for bulk float data.

---

## 5. Operational Flows

### 5.1 User Registration & Authentication

1. User submits the registration form → Axios `POST /api/v1/auth/register` (JSON).
2. FastAPI validates via `UserCreate` Pydantic schema.
3. `UserService.create_user` hashes the password (bcrypt) and calls `UserRepository.create`.
4. `UserRepository` persists the record to PostgreSQL.
5. On login, `UserService.authenticate` verifies the bcrypt hash; on success, a signed JWT is returned.
6. `AuthContext` stores the token in `localStorage` and injects it as `Authorization: Bearer <token>` on every subsequent request.

### 5.2 Signal Upload & Processing Pipeline (US-1)

Signal processing uses a **two-step upload flow**:

**Step 1 — Upload**
1. Engineer uploads a CSV/Parquet file → `POST /api/v1/signals/upload` (multipart/form-data).
2. `StorageAdapter` streams the file to Blob Storage. A `signal_metadata` record is created with `status = AWAITING_CONFIG`.
3. Frontend fetches `GET /api/v1/signals/{id}/raw-columns` to preview column names, dtypes, and sample values without running the full pipeline.
4. User selects a time column and one or more signal columns (and optionally the CSV format `wide` | `stacked`). For stacked format the user also selects the **datetime axis column** (auto-populated from the first temporal candidate). The user may optionally select a **unit column** (any string-dtype column whose values contain physical unit strings such as `"mV"` or `"°C"`).

**Step 2 — Process**
5. Frontend posts `POST /api/v1/signals/{id}/process` with `{csv_format, time_column, signal_columns, datetime_column?, unit_column?}`. Status transitions to `PROCESSING`.
6. `SignalService` triggers `run_pipeline` as a FastAPI `BackgroundTask`.
7. **Domain Processing:**
   - `ColumnInspector` validates the selected columns and detects the CSV format (wide vs. stacked). Shared format constants (`STACKED_REQUIRED_COLS`, `STACKED_COL_ALIASES`) live in `domain/signal/format_constants.py`.
   - `RollingVarianceClassifier` tags every timestamp as `IDLE`, `ACTIVE`, or `OOC`.
   - `ActiveRunSegmenter` groups continuous `ACTIVE` blocks into `RunSegment` records with unique `run_id`s.
   - Aggregate features (duration, max, min, variance, OOC count) are computed per run.
   - If `unit_column` was supplied, `_extract_channel_units` derives a per-channel unit string (mode of the column's values for that channel). Each unit is written as a constant `__unit_<channel_name>` column in the processed Parquet file. `channel_units` is **not** stored in SQL — it lives exclusively in Parquet (see ADR-008).
   - If the time column is a temporal datetime type, the Unix epoch seconds of the first sample (`t0_epoch_s`) is stored as a constant column in the processed Parquet.
8. Run metadata is persisted to the `run_segments` table; processed chunks are written back to Blob Storage. Signal status is updated to `COMPLETED`. All `status` transitions explicitly set `updated_at = func.now()` via Core SQL to bypass SQLAlchemy ORM `onupdate` limitations.

### 5.3 Macro-Micro Visualization Flow (US-2 & US-3)

1. Dashboard loads → `GET /api/v1/signals/{id}/macro` fetches the global view at **full resolution** (all original data points).
2. The response includes `t0_epoch_s` (Unix epoch of first sample, or `null` for numeric time axes). When set, the frontend converts each elapsed-second x-value to an ISO date string before passing to Plotly.
3. Plotly renders the Macro Timeline with `ACTIVE`/`OOC` background shapes.
   - Multi-channel signals use `MultiChannelMacroChart`: stacked horizontal subpanels, one per channel, sharing a single x-axis. When `channel_units` is present in the macro response, each panel's y-axis title is set to the corresponding physical unit string (e.g. `"mV"`, `"°C"`).
   - Single-channel signals use a flat Plotly chart with a range slider.
4. User drags the brush tool → the `onRelayout` event fires. If a datetime axis is active, the ISO string range values are converted back to elapsed seconds using `t0_epoch_s` before comparing against `RunBound.start_x/end_x`.
5. `GET /api/v1/signals/{id}/runs?run_ids=1,2,...10` fetches full-resolution chunk data for selected runs.
6. React renders the `MicroChart` grid (Small Multiples), one per run.
7. On hover over any chart, the relative X percentage is calculated and dispatched → all other charts render a synchronized vertical crosshair at the same position.

### 5.4 STFT Parameter Exploration Flow

1. The user opens the **STFT Explorer** panel (collapsible, below the Macro Timeline) for a COMPLETED signal.
2. User selects a channel from the channel list → `useSTFTExplorer` resets to `idle` phase.
3. User brushes a time window on the Macro Timeline → `handleBrushSelect(startS, endS)` is called (debounced 300 ms). Window size is derived as the next power-of-two sample count.
4. After the debounce, `GET /signals/{id}/analysis/stft` fires. The backend:
   - Validates ownership + COMPLETED status.
   - Reads only `timestamp_s` and the selected channel column from Parquet (Polars projection).
   - Infers sampling rate from the median inter-sample interval.
   - Dispatches `compute_stft(segment, sr, config)` to a `ProcessPoolExecutor` worker.
   - Returns `STFTResponse`: `frequencies_hz`, `magnitudes`, `dominant_frequency_hz`, `sampling_rate_hz`.
5. `FFTSpectrumChart` renders the magnitude spectrum. Phase transitions to `exploring`.
6. User tunes window function and overlap percentage in `STFTParamControls`, then clicks **Lock Window** → phase `locked`. Window size is frozen.
7. User clicks **Generate Spectrogram** → `GET /signals/{id}/analysis/spectrogram` fires. The backend:
   - Dispatches `compute_spectrogram(amplitudes, sr, config)` to the process pool.
   - Pre-selects only 2,000 time bins when the natural frame count exceeds the cap (avoiding redundant FFTs).
   - Returns `SpectrogramResponse`: `time_bins_s`, `frequency_bins_hz`, `magnitude_db[][]`, `downsampled`.
8. `SpectrogramChart` renders the dBFS heatmap. When `t0_epoch_s` is set, `time_bins_s` is converted to ISO date strings so the x-axis matches the Macro Timeline. Phase `spectrogram_ready`.

---

## 6. API Contracts

All responses are validated by Pydantic v2 schemas. The frontend will **never** receive malformed data. States are strictly `IDLE | ACTIVE | OOC` enums.

All error responses use a standard envelope:
```json
{ "error": { "code": "NOT_FOUND", "message": "Signal not found", "timestamp": "ISO8601" } }
```

**HTTP error codes and their domain mapping:**

| Status | `code` field | Raised by |
|--------|-------------|-----------|
| `404 Not Found` | `NOT_FOUND` | `NotFoundException` — resource not found |
| `409 Conflict` | `CONFLICT` | `ConflictException` — wrong pipeline state or duplicate resource |
| `422 Unprocessable Entity` | `VALIDATION_ERROR` | `ValidationException` — bad input parameters, unknown column, path traversal; also Pydantic `RequestValidationError` |
| `500 Internal Server Error` | `INTERNAL_SERVER_ERROR` | `InfrastructureException` (DB/storage fault) or unexpected exception — details logged server-side only |

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `POST` | `/api/v1/auth/register` | None | Create a new user account |
| `POST` | `/api/v1/auth/login` | None | Obtain JWT (OAuth2 form) |
| `GET` | `/api/v1/users/me` | Bearer JWT | Get current user profile |
| `POST` | `/api/v1/signals/upload` | Bearer JWT | Upload raw signal file; returns `202 Accepted` + `AWAITING_CONFIG` status |
| `GET` | `/api/v1/signals` | Bearer JWT | List all signal jobs for the current user |
| `GET` | `/api/v1/signals/{id}/raw-columns` | Bearer JWT | Preview column names, dtypes, and sample values without running the pipeline |
| `POST` | `/api/v1/signals/{id}/process` | Bearer JWT | Submit column config and trigger the processing pipeline |
| `GET` | `/api/v1/signals/{id}/macro` | Bearer JWT | Full-resolution global view + run bounds + t0_epoch_s |
| `GET` | `/api/v1/signals/{id}/runs?run_ids=…` | Bearer JWT | Full-resolution chunk data for selected run IDs |
| `GET` | `/api/v1/signals/{id}/analysis/stft` | Bearer JWT | FFT magnitude spectrum for a brushed time window |
| `GET` | `/api/v1/signals/{id}/analysis/spectrogram` | Bearer JWT | Full-signal sliding-window spectrogram (time × freq dBFS heatmap) |

### Signal Upload Response (`202 Accepted`)
```json
{ "id": "uuid", "original_filename": "string", "status": "AWAITING_CONFIG", "created_at": "ISO8601" }
```

### Raw Columns Response (`200 OK`)
```json
{
  "signal_id": "uuid",
  "columns": [{ "name": "time", "dtype": "Float64", "null_count": 0, "sample_values": ["0.0", "0.1"], "is_candidate_time": true }],
  "csv_format": "wide",
  "stacked_signal_names": []
}
```

### Process Request
```json
{
  "csv_format": "wide",
  "time_column": "time",
  "signal_columns": ["ch1", "ch2"],
  "datetime_column": "measurement_datetime",
  "unit_column": "unit"
}
```
- `datetime_column` — optional; overrides alias detection for the stacked datetime axis column. Omit to use automatic alias resolution.
- `unit_column` — optional; a string-dtype CSV column whose values contain physical unit strings (e.g. `"mV"`). Supported by both `wide` and `stacked` formats.

### Macro View Response (`200 OK`)
```json
{
  "signal_id": "uuid",
  "x": [0.0, 0.1, "..."],
  "channels": [
    { "channel_name": "ch1", "y": [0.12, 0.87, "..."], "states": ["ACTIVE", "OOC", "..."] }
  ],
  "runs": [{ "run_id": "uuid", "run_index": 1, "start_x": 0.0, "end_x": 142.5, "ooc_count": 2 }],
  "t0_epoch_s": 1700000000.0,
  "channel_units": { "ch1": "mV", "ch2": "°C" }
}
```
- `t0_epoch_s` is `null` for numeric (non-datetime) time columns. When set, reconstruct absolute datetime for index `i` as: `new Date((t0_epoch_s + x[i]) * 1000)`.
- `channel_units` is omitted when no `unit_column` was selected during processing. When present, each key is a channel name and the value is its physical unit string. The `MultiChannelMacroChart` uses this to set per-panel y-axis titles.

### Run Chunk Response (`200 OK`)
```json
[{ "run_id": "uuid", "run_index": 1, "duration_seconds": 142.5, "value_max": 9.87,
   "value_min": 0.11, "value_mean": 4.53, "value_variance": 1.22, "ooc_count": 3,
   "x": [0.0, 0.1, "..."],
   "channels": [{ "channel_name": "ch1", "y": [4.1, 4.3, "..."], "states": ["ACTIVE", "OOC", "..."] }] }]
```

### STFT Request (query parameters)

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `channel_name` | `string` | required | must be a processed channel name |
| `start_s` | `float` | required | ≥ 0 |
| `end_s` | `float` | required | > 0, clamped to signal duration |
| `window_fn` | `string` | `"hann"` | one of 15 supported window functions |
| `window_size` | `int` | `1024` | power of 2, range [4, 131072] |

### STFT Response (`200 OK`)
```json
{
  "signal_id": "uuid",
  "channel_name": "ch1",
  "frequencies_hz": [0.0, 9.77, "..."],
  "magnitudes": [0.0, 0.42, "..."],
  "dominant_frequency_hz": 50.0,
  "window_config": { "start_s": 10.0, "end_s": 11.05, "window_fn": "hann", "window_size": 1024 },
  "sampling_rate_hz": 1000.0
}
```

### Spectrogram Request (query parameters)

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `channel_name` | `string` | required | must be a processed channel name |
| `window_fn` | `string` | `"hann"` | one of 15 supported window functions |
| `window_size` | `int` | `1024` | power of 2, range [4, 131072] |
| `hop_size` | `int` | `512` | ≥ 1 and ≤ `window_size` |

### Spectrogram Response (`200 OK`)
```json
{
  "signal_id": "uuid",
  "channel_name": "ch1",
  "time_bins_s": [0.51, 1.02, "..."],
  "frequency_bins_hz": [0.0, 9.77, "..."],
  "magnitude_db": [[-20.1, -45.3, "..."], "..."],
  "sampling_rate_hz": 1000.0,
  "downsampled": false
}
```
- `magnitude_db` shape: `[n_time_bins × n_freq_bins]`, values in dBFS (peak-normalised: 0 dBFS = maximum magnitude across the entire spectrogram).
- `downsampled` is `true` when the natural frame count exceeded 2,000 and the time axis was pre-selected (no quality loss — only the frames that would appear in the heatmap are computed).
- Returns `413 Request Entity Too Large` when the payload would exceed `STFT_MAX_RESPONSE_MB` (default 50 MB). Increase `hop_size` or reduce `window_size` to shrink the response.

---

## 7. Database Schema

```sql
CREATE TABLE users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email            VARCHAR(255) UNIQUE NOT NULL,
    hashed_password  VARCHAR(255) NOT NULL,
    is_active        BOOLEAN DEFAULT TRUE,
    is_superuser     BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE signal_metadata (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(500) NOT NULL,
    file_path         TEXT NOT NULL,
    -- AWAITING_CONFIG → PENDING → PROCESSING → COMPLETED | FAILED
    status            VARCHAR(20) NOT NULL DEFAULT 'AWAITING_CONFIG',
    total_points      BIGINT,
    active_run_count  INTEGER DEFAULT 0,
    ooc_count         INTEGER DEFAULT 0,
    error_message     TEXT,
    -- Column selection (set by POST /process)
    time_column       VARCHAR(255),
    signal_columns    JSONB,                -- list[str]
    channel_names     JSONB,               -- list[str], populated after processing
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ⚠️ updated_at is NOT managed by SQLAlchemy onupdate — every Core SQL UPDATE
-- must explicitly include `updated_at = func.now()` in its VALUES clause.

CREATE TABLE run_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id        UUID NOT NULL REFERENCES signal_metadata(id) ON DELETE CASCADE,
    run_index        INTEGER NOT NULL,
    start_x          DOUBLE PRECISION NOT NULL,
    end_x            DOUBLE PRECISION NOT NULL,
    duration_seconds DOUBLE PRECISION,
    value_max        DOUBLE PRECISION,
    value_min        DOUBLE PRECISION,
    value_mean       DOUBLE PRECISION,
    value_variance   DOUBLE PRECISION,
    ooc_count        INTEGER DEFAULT 0,
    chunk_file_path  TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);
```

---

## 8. Architecture Decision Records (ADRs)

### ADR-001 — File Storage Strategy
- **Decision:** `LocalStorageAdapter` for the prototype; `MinIOStorageAdapter` for production.
- **Rationale:** The `IStorageAdapter` interface (Strategy Pattern) decouples business logic from storage implementation. Swapping requires only changing the DI binding — zero business logic changes.
- **Risk:** Local FS has no redundancy. Not production-safe without the MinIO/S3 swap.

### ADR-002 — Pipeline Execution Model
- **Decision:** FastAPI `BackgroundTasks` for the prototype. Migrate to ARQ/Celery when jobs exceed ~30 s.
- **Rationale:** No extra infrastructure for the prototype. `PipelineOrchestrator` is execution-model agnostic via its interface.
- **Risk:** In-process tasks share server memory. A crash during processing loses the job — acceptable at prototype stage.

### ADR-003 — Raw Signal Storage: Parquet over PostgreSQL
- **Decision:** Raw time-series data stored as `.parquet` files in Blob Storage, not as SQL rows.
- **Rationale:** PostgreSQL is not optimized for millions of float time-series rows per upload. Columnar Parquet reads via Polars/Pandas are 10–100× faster for bulk range queries. TimescaleDB is the upgrade path for real-time streaming.

### ADR-004 — LTTB Downsampling Removed from Macro View
- **Decision:** LTTB downsampling was **removed** from the macro view endpoint. All original data points are returned at full resolution.
- **Rationale:** Modern WebGL-backed Plotly `scattergl` traces can render hundreds of thousands of points at 60 FPS directly in the browser. LTTB's visual approximation introduced subtle extrema distortion that was unacceptable for OOC anomaly detection (a missed spike could disappear after downsampling). Full resolution ensures every OOC marker is visible.
- **Risk:** Very large signals (>10M points) may cause browser memory pressure. Mitigation: introduce progressive loading or server-driven LTTB as an opt-in parameter if needed in production.

### ADR-005 — Two-Step Upload Flow (Column Selection)
- **Decision:** Signal processing is gated by an explicit column-selection step (`AWAITING_CONFIG → process`), rather than auto-detecting columns at upload time.
- **Rationale:** Real-world CSVs have ambiguous or identically-typed columns. Auto-detection is unreliable. Showing the user a `GET /raw-columns` preview (dtype, null count, sample values) before triggering the expensive pipeline prevents silent misconfigurations and wasted compute.
- **Trade-off:** Two round-trips instead of one. Acceptable because the upload itself is cheap and the pipeline is expensive.

### ADR-006 — Stacked CSV Format Support
- **Decision:** The pipeline supports two CSV layouts: `wide` (one column per channel) and `stacked` (long/tidy format with `timestamp`, `signal_name`, `value` columns).
- **Rationale:** Many industrial data exports use stacked (long) format. Supporting both formats eliminates pre-processing by the user. Shared constants (`STACKED_REQUIRED_COLS`, `STACKED_COL_ALIASES`) live in `domain/signal/format_constants.py` — a single source of truth for both the pipeline and the column inspector.

### ADR-007 — Comprehensive Exception Hierarchy & Centralized Error Handling
- **Decision:** All API error responses are wrapped in `{"error": {"code": "…", "message": "…", "timestamp": "…"}}`. A four-class exception hierarchy in `app/core/exceptions.py` covers every failure mode; all HTTP mapping is centralized in `app/main.py` global handlers. Endpoints contain zero `try/except` boilerplate for domain errors.
- **Exception hierarchy:**
  - `DomainException` — abstract base for all business-logic failures (not `HTTPException`; no FastAPI import)
    - `NotFoundException` → **404 Not Found**
    - `ConflictException` → **409 Conflict** (wrong state, duplicate resource)
    - `ValidationException` → **422 Unprocessable Entity** (bad request parameters, unknown column, etc.)
  - `InfrastructureException` — wraps storage (`OSError`) and database (`SQLAlchemyError`) faults → **500 Internal Server Error** (logged server-side; generic message to client)
- **Layer responsibilities:**
  - **Domain / Application layers:** raise only `DomainException` subclasses or `InfrastructureException` — never `HTTPException`, `ValueError`, `KeyError`, or `LookupError`.
  - **Infrastructure (repositories + storage):** catch `IntegrityError` → `ConflictException`; `SQLAlchemyError` → `InfrastructureException` (with `session.rollback()`); `OSError` / `FileNotFoundError` → `InfrastructureException`; path-traversal attempts → `ValidationException`.
  - **Presentation (endpoints):** no domain `try/except` blocks; all exceptions bubble to the global handlers registered in `main.py`.
- **Rationale:** Ensures the frontend always parses a predictable error shape. Eliminates duplicated error-handling boilerplate across 3 endpoint files. Keeps the domain and application layers framework-free. Infrastructure errors are logged with full traceback (`logger.exception`) but clients receive only a safe, generic message — no internal paths or stack traces are leaked.
- **Tests:** `tests/test_error_handling.py` — 22 tests covering hierarchy, HTTP mapping (isolated `TestClient`), service-level exceptions, storage exceptions, and path-traversal guard.

### ADR-008 — Channel Units Stored in Parquet, Not SQL
- **Decision:** Physical unit strings per channel are written as constant `__unit_<channel_name>` columns in the processed Parquet file. They are **not** stored in a SQL column on `signal_metadata`.
- **Rationale:** Units are a pipeline artifact derived at processing time. Storing them in Parquet requires zero schema migration; adding a JSONB column to SQL would require an Alembic migration for every future attribute of this kind. Units are read lazily at `GET /macro` time by scanning `__unit_*` prefixed columns — a single Polars column read that adds negligible overhead.
- **Trade-off:** Units are not queryable from SQL. Acceptable because no business logic depends on filtering or aggregating by unit.

### ADR-009 — datetime_column Optional for Backward Compatibility
- **Decision:** `datetime_column` in `ProcessSignalRequest` is optional (`str | None`, default `None`). When omitted, the pipeline falls back to existing `STACKED_COL_ALIASES` detection.
- **Rationale:** Existing API clients that do not send `datetime_column` continue to work unchanged. The frontend always sends the user-selected value, but old integrations and test suites remain unaffected. This preserves backward compatibility without a versioned endpoint.

### ADR-010 — ProcessPoolExecutor for CPU-Bound Spectral Analysis
- **Decision:** STFT / spectrogram computation runs inside a module-level `ProcessPoolExecutor` (managed by `app/infrastructure/executor.py`). The event loop dispatches via `asyncio.get_running_loop().run_in_executor(get_executor(), fn, *args)`.
- **Rationale:** NumPy/SciPy FFT is CPU-bound and holds the Python GIL during large transforms. A `ThreadPoolExecutor` would block the asyncio event loop. A `ProcessPoolExecutor` gives each worker its own GIL, enabling true multi-core execution and keeping the FastAPI server non-blocking under concurrent analysis requests. Workers are pre-forked at startup (via the FastAPI lifespan handler) and warmed up by importing NumPy/SciPy eagerly — first-request latency stays low.
- **Configuration:** `ANALYSIS_WORKERS` environment variable overrides the worker count (default: `max(2, os.cpu_count())`). `STFT_MAX_RESPONSE_MB` caps the spectrogram response size (default: 50 MB).
- **Three-level concurrency:** (1) Algorithm pre-selects ≤ 2,000 frames before any FFT to minimise total work. (2) `scipy.fft.rfft(workers=-1)` uses pocketfft threads inside each worker. (3) Multiple concurrent analysis requests each run in a separate worker process.
- **Risk:** Process startup overhead on the first request is amortised by pre-forking. Large spectrograms that exceed `STFT_MAX_RESPONSE_MB` return HTTP 413 instead of silently consuming all server memory.

---

## 9. Known Issues & Implementation Status

### ✅ All Critical / Minor Bugs — Fixed

| ID | File | Fix Applied |
|----|------|-------------|
| B1 | `frontend/src/pages/Register.tsx` | Endpoint corrected to `POST /auth/register` |
| B2 | `backend/app/main.py` | `CORSMiddleware` added; `CORS_ORIGINS` in settings |
| B3 | `frontend/src/index.css` | `--color-brand-400: #60a5fa` added to `@theme` |
| B4 | `frontend/src/lib/plot.ts` | Fixed Vite ESM interop wrapping CJS react-plotly.js export in a default object |

### ✅ All Architecture Violations — Fixed

| ID | Location | Fix Applied |
|----|----------|-------------|
| A1 | `domain/user/repository.py` | `get_password_hash` moved to `UserService`; repo accepts pre-hashed password |
| A2 | `backend/main.py` (root) | Stub removed; comment points to real entry point |
| A3 | `presentation/api/v1/endpoints/users.py` | `read_user_me` changed to `async def` |

### ✅ Backend Code Quality Review — All Issues Fixed

| ID | Severity | File | Fix Applied |
|----|----------|------|-------------|
| BQ1 | 🔴 Critical | `repository.py` | `updated_at` was silently not updated by Core SQL `UPDATE` statements (SQLAlchemy ORM `onupdate` doesn't fire for Core SQL). Added explicit `updated_at=func.now()` to all 4 update methods. |
| BQ2 | 🔴 Critical | `service.py`, `endpoints/signals.py` | `ValueError("Signal not found")` was caught as HTTP 422. Added `NotFoundException` (plain `Exception`, not `HTTPException`) in `core/exceptions.py`; mapped to 404 at the presentation layer. |
| BQ3 | 🟡 Medium | `pipeline.py`, `column_inspector.py` | `_STACKED_COL_ALIASES` was defined identically in two files (DRY violation). Extracted to `domain/signal/format_constants.py` as the single source of truth. |
| BQ4 | 🟡 Medium | `service.py`, `repository.py` | Deferred imports inside functions moved to module top level. |
| BQ5 | 🟡 Medium | `pipeline.py` | ~15-line temporal epoch arithmetic block duplicated across two reader functions. Extracted to `_parse_temporal_time_column()` helper. |
| BQ6 | 🟡 Medium | `endpoints/signals.py` | 6 routes missing `summary=` parameter. Added summaries for OpenAPI docs. |
| BQ7 | 🟡 Medium | `main.py` | No standard error response envelope. Added `_global_exception_handler` wrapping all `HTTPException` errors in `{"error": {"code": …, "message": …, "timestamp": …}}`. |
| BQ8 | 🔵 Low | `service.py` | `_background_tasks` module-level set undocumented. Added GC-prevention comment. |

### ✅ Frontend Code Quality Review — All Issues Fixed

| ID | Severity | File | Fix Applied |
|----|----------|------|-------------|
| FQ1 | 🔴 Critical | `Dashboard.tsx` | `handleMacroRelayout` cast Plotly range values to `number`, but a datetime axis returns ISO strings. Run chunks never loaded when `t0_epoch_s` was set. Fixed: ISO strings are converted back to elapsed seconds via `t0_epoch_s` before comparing against `RunBound.start_x/end_x`. |
| FQ2 | 🔴 Critical | `MultiChannelMacroChart.tsx` | `useMemo(layout)` had `visibleChannels` missing from deps, masked by `// eslint-disable-next-line react-hooks/exhaustive-deps`. Replaced with proper hook decomposition: `useMemo(channels)`, `useCallback(toXValue)`, `useMemo(xValues)`, `useMemo(domains)`, `useMemo(traces)`, `useMemo(layout)` — all with exhaustive deps. |
| FQ3 | 🟡 Medium | `chartTheme.ts` | `DARK_AXIS` was missing `showgrid: true` and `griddash: 'dash'` (present in `LIGHT_AXIS`). Dark-mode `MicroChart` instances had no grid lines. Added both properties. |
| FQ4 | 🟡 Medium | `Dashboard.tsx` | `macroShapes`, `allGroupChannelKeys`, `macroLayout`, `groupLayout` recomputed on every render (no `useMemo`), causing unnecessary Plotly re-renders. All 4 wrapped in `useMemo` with correct deps. |
| FQ5 | 🟡 Medium | `Dashboard.tsx` | `handleMacroRelayout` had no `catch` block — `getRunChunks` failures were silently swallowed. Added `catch`, `runError` state, and a user-visible error banner. |
| FQ6 | 🟡 Medium | `Dashboard.tsx` | `MicroChart` component was defined inside the 697-line `Dashboard.tsx`. Extracted to `src/components/MicroChart.tsx`. |

### ✅ Signals Domain — Fully Implemented

| Area | Status |
|------|--------|
| `/api/v1/signals` router + 7 endpoints | ✅ Implemented |
| `SignalService`, pipeline orchestration | ✅ Implemented |
| `SignalMetadata`, `RunSegment` ORM models + Pydantic schemas | ✅ Implemented |
| `RollingVarianceClassifier`, `ActiveRunSegmenter` algorithms | ✅ Implemented |
| `SignalRepository`, `IStorageAdapter` / `LocalStorageAdapter` | ✅ Implemented |
| Wide CSV + Stacked CSV format detection and parsing | ✅ Implemented |
| Temporal datetime time-column parsing + `t0_epoch_s` | ✅ Implemented |
| Two-step upload flow (column selection → process) | ✅ Implemented |
| Standardized error envelope + comprehensive exception hierarchy | ✅ Implemented |
| `format_constants.py` single source of truth for stacked format | ✅ Implemented |
| Alembic initial migration | ✅ Creates all 3 tables |
| `FileUploader` + `ColumnConfigPanel` components | ✅ Implemented |
| Dashboard macro timeline + brush + state highlights | ✅ Implemented |
| Multi-channel stacked chart (`MultiChannelMacroChart`) | ✅ Implemented |
| Datetime x-axis with ISO date formatting | ✅ Implemented |
| Small Multiples grid (`MicroChart`) + synchronized crosshairs | ✅ Implemented |
| Auto-polling for PENDING/PROCESSING signals | ✅ Implemented |
| **Datetime axis column selector** (stacked format, `DatetimeColumnSelector`) | ✅ Implemented |
| **Unit column selector** (optional, both formats, `UnitColumnSelector`) | ✅ Implemented |
| **Per-channel y-axis unit labels** (`channel_units` → `MultiChannelMacroChart`) | ✅ Implemented |
| `_extract_channel_units` + `__unit_<ch>` Parquet columns | ✅ Implemented |
| **STFT domain engine** (`domain/analysis/stft_engine.py`) — `compute_stft` + `compute_spectrogram` | ✅ Implemented |
| **STFT Pydantic schemas** (`domain/analysis/schemas.py`) — `STFTWindowConfig`, `SpectrogramConfig`, `WindowFunction`, response DTOs | ✅ Implemented |
| **STFTService** (`application/analysis/stft_service.py`) — ownership check, Parquet projection, sampling-rate inference, executor dispatch, payload cap | ✅ Implemented |
| **Analysis API endpoints** (`presentation/api/v1/endpoints/analysis.py`) — `GET /stft`, `GET /spectrogram` | ✅ Implemented |
| **ProcessPoolExecutor** (`infrastructure/executor.py`) — start/stop/get lifecycle via FastAPI lifespan, warm-up, `ANALYSIS_WORKERS` config | ✅ Implemented |
| **STFT Explorer UI** (`STFTExplorerPanel`, `FFTSpectrumChart`, `SpectrogramChart`, `STFTParamControls`) | ✅ Implemented |
| **`useSTFTExplorer` hook** — `useReducer` state machine, debounce, `AbortController`, phase transitions | ✅ Implemented |
| **Datetime axis sync in spectrogram** — `t0_epoch_s` → ISO date strings on spectrogram x-axis | ✅ Implemented |
| **STFT test suite** (`backend/tests/test_stft_engine.py`) — 340-line coverage of engine, edge cases | ✅ Implemented |
| **Comprehensive error handling** — 4-class exception hierarchy (`DomainException`, `NotFoundException`, `ConflictException`, `ValidationException`, `InfrastructureException`); centralized global handlers in `main.py`; all repositories and storage adapter wrap DB/OS errors; all endpoints clean of boilerplate try/except | ✅ Implemented |
| **Error handling test suite** (`backend/tests/test_error_handling.py`) — 22 tests covering hierarchy, HTTP mapping, service-layer, storage, path-traversal guard | ✅ Implemented |

---

## 10. Technology Stack & Quality Standards

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend language | Python 3.12 | Strict type hints throughout |
| Backend framework | FastAPI | Async-first, OpenAPI auto-docs |
| ORM | SQLAlchemy 2.0 (Async) + asyncpg | AsyncSession pattern |
| Data validation | Pydantic v2 | Schemas as enforced data contracts |
| Signal processing | NumPy + SciPy | STFT engine, spectrogram, FFT via pocketfft |
| Concurrency | `ProcessPoolExecutor` | CPU-bound STFT offloaded to worker processes |
| Security | bcrypt + PyJWT | Isolated in `SecurityAdapter` |
| Package manager | `uv` | Lockfile at `uv.lock` |
| Linter/formatter | `ruff` | PEP 8++ enforcement |
| Frontend framework | React 19 + TypeScript | Strict TS config |
| Bundler | Vite | Hot module replacement |
| Styling | Tailwind CSS v4 | `@theme` design tokens |
| Visualization | Plotly.js (WebGL) | `react-plotly.js` wrapper; scattergl + heatmap |
| HTTP client | Axios | Request/response interceptors for JWT |
| Routing | React Router v7 | Protected routes via `MainLayout` |

**Clean Architecture Rule:** Domain Layer has zero framework imports. Dependencies point inward only: Presentation → Application → Domain ← Infrastructure.

**Visual Standards:** CERN CMS / academic journal style. Monospace fonts for all numbers and axes. No decorative shadows or background fills. Deep red (#ef4444) for OOC anomaly markers. Data-ink ratio maximized.

---

## 11. Git Branch Strategy

Signal Probe uses a **two-protected-branch gitflow**:

```
master  ←── production; protected; tag-triggered releases; PR-only merges
  │
dev     ←── integration; protected; all features merge here; PR-only merges
  │
  ├── feature/<issue-N>-<slug>      (e.g. feature/12-add-gantt-chart)
  ├── fix/<issue-N>-<slug>          (e.g. fix/7-cors-middleware)
  ├── chore/<slug>                  (e.g. chore/bump-v0.2.0)
  └── docs/<issue-N>-<slug>
```

**Rules:**
- **Never** push directly to `dev` or `master`.
- Always branch from the latest `dev`, not `master`.
- Version bump commits go on `dev` via a `chore/bump-vX.Y.Z` branch.
- Push the tag **after** the `dev → master` PR merges: `git push origin vX.Y.Z`
- Pushing a `vX.Y.Z` tag triggers `release.yml` automatically.

### Commit Message Convention (Conventional Commits)

| Prefix | When to use |
|--------|------------|
| `feat:` | New feature or endpoint |
| `fix:` | Bug fix |
| `refactor:` | Internal restructuring, no behaviour change |
| `docs:` | README, HANDSBOOK, or docstring-only changes |
| `test:` | Tests only |
| `chore:` | Tooling, CI config, dependency bumps |

Always append when Copilot contributes:
```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

---

## 12. Repository Bootstrap

### First-Time Setup (per clone)

```bash
# 1. Clone and enter the repo
git clone <REPO_URL>
cd signal-probe

# 2. Backend — create venv and install dependencies
cd backend
uv venv
source .venv/bin/activate          # macOS/Linux
uv sync                            # installs all deps including bump-my-version
deactivate
cd ..

# 3. Frontend — install Node dependencies
cd frontend
npm install
cd ..

# 4. Install and register pre-commit hooks (MUST run once per clone)
pip install pre-commit              # or: uv tool install pre-commit
pre-commit install

# 5. Verify all hooks pass on the full codebase
pre-commit run --all-files

# 6. Copy env template and configure (backend)
cp backend/.env.example backend/.env
# Edit backend/.env: set DATABASE_URL, SECRET_KEY, STORAGE_PATH

# 7. Run database migrations
cd backend && uv run alembic upgrade head && cd ..

# 8. Start services (two terminals)
#   Terminal 1 — backend:
cd backend && uv run uvicorn app.main:app --reload

#   Terminal 2 — frontend:
cd frontend && npm run dev
```

### Version Release SOP

```bash
# Always run on a chore/ branch off dev
git checkout dev && git pull
git checkout -b chore/bump-vX.Y.Z

# Activate the backend venv (bump-my-version lives there)
source backend/.venv/bin/activate

# Dry-run to preview changes
cd backend && bump-my-version bump patch --dry-run --verbose   # or minor / major

# Apply the bump (creates commit + tag on current branch)
bump-my-version bump patch && cd ..

# Push branch (NOT the tag yet)
git push origin chore/bump-vX.Y.Z

# Open PR: chore/bump-vX.Y.Z → dev, then dev → master
# After dev → master PR is merged, push the tag:
git push origin vX.Y.Z
# This triggers release.yml and creates a GitHub Release automatically.
```

> ⚠️ Push the tag **after** `dev → master` merges. Never push directly to `master`.

### CI / CD Overview

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | Push / PR to `dev` or `master` | `backend-checks` (ruff) + `frontend-checks` (tsc + eslint + build) |
| `release.yml` | Push tag `vX.Y.Z` | Verify CI → build frontend dist → create GitHub Release |

### Common Pitfalls

| Problem | Fix |
|---------|-----|
| `pre-commit` fails in CI but passes locally | Ensure `pip install -e ".[dev]"` runs before pre-commit in CI (already wired in `ci.yml`) |
| `uvx: command not found` | Install uv globally (`curl -LsSf https://astral.sh/uv/install.sh | sh`) |
| Tag pushed before `master` merge | Release will point to a non-master state — push tag only after merge |
| `git push origin master` rejected | Branch is protected — open a PR from `dev` |
