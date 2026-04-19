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
- **FR-2.1** Global trend chart with backend LTTB downsampling before data is sent to the browser.
- **FR-2.2** Background color highlights for `ACTIVE` / `IDLE` / `OOC` state bounds on the timeline axis.
- **FR-2.3** Draggable brush tool that selects a time range and dynamically updates the Micro Grid below.

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
|  | - File Uploader         |    |  |  (LTTB Downsampled)|  |  (Small Multiples) |  |  |
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

### 4.1 Frontend Components

- **UI & State:** React components manage layout, forms, and tools. `AuthContext` handles global JWT state via React Context API.
- **Visualization Engine (Plotly.js):**
  - **WebGL Rendering:** Bypasses the DOM and renders directly to GPU canvas — essential for 60 FPS on dense time-series.
  - **Macro Timeline:** Downsampled global view with a Brush tool for time-range selection.
  - **Micro Grid:** Dynamic grid of Plotly instances (one per Run) with synchronized crosshairs.
- **Scientific Visual Standards:** Monospace typography for axes, high-contrast deep-red markers for OOC points, no decorative chart junk.

### 4.2 Backend — Domain-Driven Design (DDD) Layers

| Layer | Responsibility | Key Rule |
|-------|---------------|----------|
| **Presentation** | FastAPI routers, Pydantic request/response validation | Never contains business logic |
| **Application** | Use-case orchestration (`SignalService`, `PipelineOrchestrator`) | Depends only on Domain interfaces (DIP) |
| **Domain** | Entities, enums, algorithms — pure Python, zero framework imports | No imports from outer layers |
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

1. Engineer uploads a CSV/Parquet file → Axios `POST /api/v1/signals/upload` (multipart/form-data).
2. `StorageAdapter` streams the file to Blob Storage. A `signal_metadata` record is created with `status = PENDING`.
3. `PipelineOrchestrator` is triggered as a FastAPI `BackgroundTask`.
4. **Domain Processing:**
   - `RollingVarianceClassifier` tags every timestamp as `IDLE`, `ACTIVE`, or `OOC`.
   - `ActiveRunSegmenter` groups continuous `ACTIVE` blocks into `RunSegment` records with unique `run_id`s.
   - Aggregate features (duration, max, min, variance, OOC count) are computed per run.
5. Run metadata is persisted to the `run_segments` table; processed chunks are written back to Blob Storage. Signal status is updated to `COMPLETED`.

### 5.3 Macro-Micro Visualization Flow (US-2 & US-3)

1. Dashboard loads → `GET /api/v1/signals/{id}/macro` fetches the global view.
2. **LTTB** reduces millions of points to ~2000, preserving visual shape and extremes. Run bounds are included for state highlighting.
3. Plotly renders the Macro Timeline with `ACTIVE`/`IDLE`/`OOC` background shapes.
4. User drags the brush tool → selected time range is mapped to `run_ids` from the run metadata array.
5. `GET /api/v1/signals/{id}/runs?run_ids=1,2,...10` fetches full-resolution chunk data for selected runs.
6. React dynamically generates N Plotly instances (Small Multiples), one per run.
7. On hover over any chart, the relative X percentage is calculated and dispatched as shared state → all other charts render a synchronized vertical crosshair at the same position.

---

## 6. API Contracts

All responses are validated by Pydantic v2 schemas. The frontend will **never** receive malformed data. States are strictly `IDLE | ACTIVE | OOC` enums.

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `POST` | `/api/v1/auth/register` | None | Create a new user account |
| `POST` | `/api/v1/auth/login` | None | Obtain JWT (OAuth2 form) |
| `GET` | `/api/v1/users/me` | Bearer JWT | Get current user profile |
| `POST` | `/api/v1/signals/upload` | Bearer JWT | Upload raw signal file; returns `202 Accepted` + job ID |
| `GET` | `/api/v1/signals` | Bearer JWT | List all signal jobs for the current user |
| `GET` | `/api/v1/signals/{id}/macro` | Bearer JWT | LTTB-downsampled global view + run bounds |
| `GET` | `/api/v1/signals/{id}/runs?run_ids=…` | Bearer JWT | Full-resolution chunk data for selected run IDs |

### Signal Upload Response (`202 Accepted`)
```json
{ "id": "uuid", "original_filename": "string", "status": "PENDING", "created_at": "ISO8601" }
```

### Macro View Response (`200 OK`)
```json
{
  "signal_id": "uuid",
  "x": [0.0, 1.0, "..."],
  "y": [0.12, 0.87, "..."],
  "runs": [{ "run_id": "uuid", "run_index": 1, "start_at": "ISO8601", "end_at": "ISO8601", "ooc_count": 2 }]
}
```

### Run Chunk Response (`200 OK`)
```json
[{ "run_id": "uuid", "run_index": 1, "duration_seconds": 142.5, "value_max": 9.87,
   "value_min": 0.11, "value_mean": 4.53, "value_variance": 1.22, "ooc_count": 3,
   "x": [0.0, 0.1, "..."], "y": [4.1, 4.3, "..."], "states": ["ACTIVE", "OOC", "..."] }]
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
    status            VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING|PROCESSING|COMPLETED|FAILED
    total_points      BIGINT,
    signal_start_at   TIMESTAMPTZ,
    signal_end_at     TIMESTAMPTZ,
    active_run_count  INTEGER DEFAULT 0,
    ooc_count         INTEGER DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE run_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id        UUID NOT NULL REFERENCES signal_metadata(id) ON DELETE CASCADE,
    run_index        INTEGER NOT NULL,
    start_at         TIMESTAMPTZ NOT NULL,
    end_at           TIMESTAMPTZ NOT NULL,
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

### ADR-004 — Server-side LTTB Downsampling
- **Decision:** LTTB runs in the backend Domain Layer, not in the browser.
- **Rationale:** Client-side downsampling would require sending the full dataset to the browser first, defeating its purpose. Server-side LTTB sends only ~2000 points regardless of dataset size, protecting browser memory and bandwidth.

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

### ✅ Signals Domain — Fully Implemented

| Area | Status |
|------|--------|
| `/api/v1/signals` router + 5 endpoints | ✅ Implemented |
| `SignalService`, `PipelineOrchestrator` | ✅ Implemented |
| `SignalMetadata`, `RunSegment` ORM models + Pydantic schemas | ✅ Implemented |
| LTTB, `RollingVarianceClassifier`, `ActiveRunSegmenter` algorithms | ✅ Implemented |
| `SignalRepository`, `IStorageAdapter` / `LocalStorageAdapter` | ✅ Implemented |
| Alembic initial migration (`a1b2c3d4e5f6`) | ✅ Creates all 3 tables |
| `FileUploader` component (drag-and-drop, CSV/Parquet) | ✅ Implemented |
| Dashboard macro timeline + brush + LTTB + state highlights | ✅ Implemented |
| Small Multiples grid + synchronized crosshairs | ✅ Implemented |
| Auto-polling for PENDING/PROCESSING signals | ✅ Implemented |

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
| `bump-my-version: command not found` | Run `source backend/.venv/bin/activate` first |
| Tag pushed before `master` merge | Release will point to a non-master state — push tag only after merge |
| `git push origin master` rejected | Branch is protected — open a PR from `dev` |
