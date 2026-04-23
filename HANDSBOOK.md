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
| **Application** | Use-case orchestration (`SignalService`, `PipelineOrchestrator`) | Depends only on Domain interfaces (DIP) |
| **Domain** | Entities, enums, algorithms — pure Python, zero framework imports | No imports from outer layers; shared format constants in `format_constants.py` |
| **Infrastructure** | SQLAlchemy repositories, storage adapters, security (bcrypt/JWT) | Implements interfaces defined by inner layers |

### 4.3 Data & Storage Strategy

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

---

## 6. API Contracts

All responses are validated by Pydantic v2 schemas. The frontend will **never** receive malformed data. States are strictly `IDLE | ACTIVE | OOC` enums.

All error responses use a standard envelope:
```json
{ "error": { "code": "NOT_FOUND", "message": "Signal not found", "timestamp": "ISO8601" } }
```

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

### ADR-007 — Standardized Error Response Envelope
- **Decision:** All API error responses are wrapped in `{"error": {"code": "…", "message": "…", "timestamp": "…"}}` via a global `HTTPException` handler in `main.py`.
- **Rationale:** Ensures the frontend always has a predictable error shape to parse. Avoids each endpoint implementing its own error format. Domain exceptions (`NotFoundException`) are plain Python exceptions — not `HTTPException` — and are mapped to HTTP status codes at the presentation layer only, preserving Clean Architecture boundaries.

### ADR-008 — Channel Units Stored in Parquet, Not SQL
- **Decision:** Physical unit strings per channel are written as constant `__unit_<channel_name>` columns in the processed Parquet file. They are **not** stored in a SQL column on `signal_metadata`.
- **Rationale:** Units are a pipeline artifact derived at processing time. Storing them in Parquet requires zero schema migration; adding a JSONB column to SQL would require an Alembic migration for every future attribute of this kind. Units are read lazily at `GET /macro` time by scanning `__unit_*` prefixed columns — a single Polars column read that adds negligible overhead.
- **Trade-off:** Units are not queryable from SQL. Acceptable because no business logic depends on filtering or aggregating by unit.

### ADR-009 — datetime_column Optional for Backward Compatibility
- **Decision:** `datetime_column` in `ProcessSignalRequest` is optional (`str | None`, default `None`). When omitted, the pipeline falls back to existing `STACKED_COL_ALIASES` detection.
- **Rationale:** Existing API clients that do not send `datetime_column` continue to work unchanged. The frontend always sends the user-selected value, but old integrations and test suites remain unaffected. This preserves backward compatibility without a versioned endpoint.

### ADR-010 — STFT Engine as a Pure Domain Module
- **Decision:** `domain/analysis/stft_engine.py` has zero FastAPI, SQLAlchemy, or Polars imports. It depends only on `numpy` and `scipy.signal`.
- **Rationale:** Clean Architecture domain invariant — the domain layer must be framework-free. Pure functions are trivially testable without mocking infrastructure. The 61-test engine suite runs in milliseconds without any DB or HTTP setup.
- **Trade-off:** A second Polars scan happens in the service layer after the domain engine returns (two reads per STFT request). Negligible for prototype; could be fused into one scan in a future optimisation pass.

### ADR-011 — Scipy as the Window Function Backend
- **Decision:** Window tapering uses `scipy.signal.get_window(name, size)` rather than hand-rolled formulas.
- **Rationale:** SciPy ships 15+ battle-tested window implementations. Maintaining custom formulas for Blackman-Harris, Nuttall, Parzen, etc., would be error-prone and untestable. `uv add scipy` adds ~30 MB to the venv but eliminates all custom DSP math.
- **Risk:** `scipy` stubs are untyped (`# type: ignore[import-untyped]` comment required). Acceptable; the function signatures are stable across SciPy releases.

### ADR-012 — Spectrogram Time Axis Downsampled to 2 000 Bins
- **Decision:** When the natural number of time bins in a spectrogram exceeds 2 000, the time axis is uniformly downsampled and `downsampled: true` is set in the response.
- **Rationale:** A 10-minute signal at 1 kHz sampling rate with a 512-sample hop produces ~1 170 frames — within limit. But a 1-hour signal produces ~7 000 frames. Sending a 7 000 × 513 matrix of `float64` values is ~29 MB per request; the default `STFT_MAX_RESPONSE_MB` cap (50 MB) provides a safety valve. Uniform index selection (`np.linspace`) preserves the temporal spread better than a random sample.

### ADR-013 — Spectrogram Computation is User-Initiated
- **Decision:** The spectrogram fetch is triggered by an explicit "Compute Spectrogram" button, not automatically when the channel or window parameters change.
- **Rationale:** The spectrogram endpoint scans the entire signal and may take several seconds for long files. Auto-triggering on every parameter change would create a poor UX (constant loading spinners) and high backend load. STFT (single window) is debounced at 150 ms and fires automatically, since it is O(window_size) — negligible.

### ADR-014 — ConflictException for Non-COMPLETED Signals
- **Decision:** `STFTService` raises `ConflictException` (HTTP 409) when the requested signal is not in `COMPLETED` status.
- **Rationale:** The analysis endpoints are only valid after the pipeline has fully processed the Parquet file. Returning 404 would be misleading (the signal exists). 409 Conflict communicates "the resource exists but its current state prevents this operation" — the correct HTTP semantics.

### ADR-015 — Median-Based Sampling Rate Inference
- **Decision:** `_infer_sampling_rate` uses `np.median(np.diff(timestamps))` rather than `mean` or the first Δt.
- **Rationale:** Real-world signals often have occasional missed samples (dropped packets, sensor glitches). The median of Δt is robust against a small number of irregular gaps, unlike the mean which is skewed by outliers. Raises `ValueError` if the median Δt ≤ 0, guarding against reversed or constant-timestamp data.

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
| Standardized error envelope (`_global_exception_handler`) | ✅ Implemented |
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

### ✅ Spectral Analysis (STFT) — Fully Implemented

#### Backend

| Area | Status |
|------|--------|
| `domain/analysis/schemas.py` — `WindowFunction` StrEnum (15 values), `STFTWindowConfig`, `SpectrogramConfig` (Pydantic v2, model_validator power-of-2 + bounds checks), `STFTResponse`, `SpectrogramResponse` | ✅ Implemented |
| `domain/analysis/stft_engine.py` — pure `compute_stft()` + `compute_spectrogram()` (zero framework imports; NumPy `rfft`/`rfftfreq` + SciPy `get_window`; dBFS; 2 000-bin downsampling) | ✅ Implemented |
| `application/analysis/stft_service.py` — `STFTService` with ownership/status/channel validation, Polars lazy columnar Parquet scan, median-based `_infer_sampling_rate()`, payload-size guard (`STFT_MAX_RESPONSE_MB`) | ✅ Implemented |
| `presentation/api/v1/endpoints/analysis.py` — `GET /{id}/analysis/stft` + `GET /{id}/analysis/spectrogram`; exception mapping 404/409/413/422 | ✅ Implemented |
| `core/exceptions.py` — `ConflictException` (HTTP 409) | ✅ Implemented |
| `presentation/api/v1/router.py` — `analysis.router` registered under `/signals` prefix | ✅ Implemented |
| `tests/test_stft_engine.py` — 61 unit tests: all 15 window functions, all 16 power-of-2 sizes, DC/Nyquist/linearity numerical accuracy | ✅ 61 tests passing |
| `scipy` dependency added via `uv add scipy` | ✅ Added |
| Total test suite | ✅ 139 tests passing, ruff clean |

#### Frontend

| Area | Status |
|------|--------|
| `types/signal.ts` — `WindowFunction` union (15 values), `STFTParams`, `STFTWindowConfig`, `STFTResponse`, `SpectrogramParams`, `SpectrogramResponse` | ✅ Implemented |
| `lib/api.ts` — `getStft()` + `getSpectrogram()` API helpers | ✅ Implemented |
| `hooks/useSTFT.ts` — `useReducer` state machine; 150 ms debounced STFT fetch; AbortController inflight cancellation; user-initiated spectrogram via `computeSpectrogram()` | ✅ Implemented |
| `components/WindowConfigControls.tsx` — `window_fn` select (15 options), `window_size` power-of-2 presets, optional `hop_size` select with overlap-fraction labels | ✅ Implemented |
| `components/TimeSignalWithWindow.tsx` — Plotly `scattergl` single-channel line + **editable vrect** shape; `onRelayout` extracts `shapes[0].x0/x1`; handles numeric and ISO-date x-axes | ✅ Implemented |
| `components/SpectrumChart.tsx` — Plotly bar chart, dominant-frequency dashed line + annotation, log/linear Y toggle, CSV export | ✅ Implemented |
| `components/SpectrogramHeatmap.tsx` — user-initiated Plotly heatmap (dBFS), colorscale selector (Viridis/Plasma/Inferno/Hot/Jet/Greys), PNG export via `PlotlyInstance.toImage`, downsampled indicator | ✅ Implemented |
| `components/STFTPanel.tsx` — layout orchestrator: channel selector + `WindowConfigControls` + `TimeSignalWithWindow` + `SpectrumChart` + `SpectrogramHeatmap` + error boundary | ✅ Implemented |
| `pages/AnalysisPage.tsx` — route `/signals/:id/analysis`; fetches signal + macro view; breadcrumb nav; COMPLETED-status guard; loading/error states | ✅ Implemented |
| `App.tsx` — route `signals/:id/analysis → <AnalysisPage />` added | ✅ Implemented |
| `pages/SignalsPage.tsx` — "Analyse →" button on COMPLETED rows navigates to `/signals/{id}/analysis` | ✅ Implemented |
| Build (`tsc -b && vite build`) | ✅ Zero errors |

---

## 10. Technology Stack & Quality Standards

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend language | Python 3.12 | Strict type hints throughout |
| Backend framework | FastAPI | Async-first, OpenAPI auto-docs |
| ORM | SQLAlchemy 2.0 (Async) + asyncpg | AsyncSession pattern |
| Data validation | Pydantic v2 | Schemas as enforced data contracts |
| Security | bcrypt + PyJWT | Isolated in `SecurityAdapter` |
| Package manager | `uv` | Lockfile at `uv.lock` |
| Linter/formatter | `ruff` | PEP 8++ enforcement |
| Frontend framework | React 19 + TypeScript | Strict TS config |
| Bundler | Vite | Hot module replacement |
| Styling | Tailwind CSS v4 | `@theme` design tokens |
| Visualization | Plotly.js (WebGL) | `react-plotly.js` wrapper |
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

---

## § 13 — STFT Spectral Analysis: Engineering Notes

### Overview

The STFT feature adds a `/signals/:id/analysis` page that lets users interactively slide a time window across a signal channel and instantly see the frequency spectrum (via STFT) and the full time-frequency heatmap (spectrogram).

### Architecture Summary

```
AnalysisPage (page)
  └── STFTPanel (orchestrator)
        ├── WindowConfigControls   ← window function, size, hop
        ├── TimeSignalWithWindow   ← editable vrect on Plotly chart
        ├── SpectrumChart          ← single-window FFT (auto, debounced)
        └── SpectrogramHeatmap     ← full spectrogram (user-initiated)
```

`useSTFT` hook owns all server state. It fires the STFT endpoint automatically with a 150 ms debounce when the window bounds or config change. Spectrogram is user-initiated via `computeSpectrogram()` to avoid large payload fetches on every parameter change.

### Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/signals/{id}/analysis/stft` | Single-window FFT → `STFTResponse` |
| `GET` | `/api/v1/signals/{id}/analysis/spectrogram` | Full STFT heatmap → `SpectrogramResponse` |

Both accept `channel_name`, `start_s`, `end_s`, `window_fn`, `window_size`, `hop_size` as query params.

### Key Implementation Details

**Window dragging (date vs numeric axis)**
`TimeSignalWithWindow` places a Plotly vrect shape with `editable: true`. On drag, `onRelayout` fires with `shapes[0].x0` and `shapes[0].x1`. When `t0_epoch_s` is present, the x-axis is `type: 'date'` and Plotly returns ISO-8601 strings — these must be converted back to seconds-from-t0 before calling the API:

```ts
const t = new Date(isoStr).getTime() / 1000 - t0_epoch_s;
```

**Spectrogram z-axis transposition**
The backend returns `magnitude_db` shaped `[n_time_bins × n_freq_bins]`. Plotly heatmap expects `z[row][col]` where row = y-axis (frequency), col = x-axis (time). Transposition:

```ts
const zData: number[][] = [];
for (let fi = 0; fi < nFreq; fi++) {
  zData[fi] = [];
  for (let ti = 0; ti < nTime; ti++) {
    zData[fi][ti] = magnitude_db[ti][fi];
  }
}
```

**Plotly TypeScript type gaps**
`@types/plotly.js@3.x` does not type several fields used in the STFT components. Use `as unknown as T` casts (not suppressions):

| Issue | Cast |
|-------|------|
| `editable` on a `Shape` | `shape as unknown as Plotly.Shape` |
| `coloraxis` on `Layout` | `layout as unknown as Partial<Plotly.Layout>` |
| `coloraxis: 'coloraxis'` on heatmap trace | `trace as unknown as Plotly.Data` |

**PNG export**
Use the static import of `plotly.js-dist-min` (matching `lib/plot.ts`). Dynamic `import('plotly.js-dist-min')` inside a callback is ineffective when the module is already statically bundled by Vite. ESM interop pattern:

```ts
import * as _Plotly from 'plotly.js-dist-min';
const PlotlyInstance = (_Plotly as any).default ?? _Plotly;
await PlotlyInstance.toImage(divRef.current, { format: 'png', ... });
```

**Sampling rate inference**
The backend uses `np.median(np.diff(timestamps))` to infer the sampling rate from the Parquet time column. Median is robust against occasional dropped samples or irregular gaps that would skew a mean.

### Running the Analysis Feature

1. Upload a CSV and process it (existing two-step flow).
2. On the Signals page, click **Analyse →** on any COMPLETED signal.
3. Select a channel → the default window loads and the spectrum renders automatically.
4. Drag the vrect on the time chart to a region of interest.
5. Adjust window function / size in `WindowConfigControls` for resolution trade-off.
6. Click **Compute Spectrogram** to fetch the full time-frequency heatmap.
7. Change colorscale or export PNG from the heatmap toolbar.

### Testing

```bash
# Backend engine unit tests (fast, no DB)
cd backend && .venv/bin/python -m pytest tests/test_stft_engine.py -v

# Full backend suite
cd backend && .venv/bin/python -m pytest tests/ -v   # 139 tests

# Frontend TypeScript build
cd frontend && npx tsc -b && npx vite build
```
