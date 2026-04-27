# Signal Probe

**Signal Probe** is a Time-Series Signal Intelligent Exploration Engineering Platform. It eliminates the "getting lost" feeling for data scientists and process engineers when navigating massive machine time-series data.

By automating feature extraction and leveraging a Macro-Micro visualization architecture, the platform transforms long-cycle raw signals into instantly comparable micro-engineering insights, significantly accelerating anomaly root-cause analysis.

## Features

- **Automated State Classification & Run Segmentation:** Tags every timestamp as `IDLE`, `ACTIVE`, or `OOC` (Out of Control) using a rolling-variance classifier, then groups active periods into independent "Runs".
- **Macro Timeline Navigation:** Full-resolution global overview (all original data points via WebGL). Includes a drag-and-drop brush tool for time-range selection. When the time column is a datetime type, the x-axis displays absolute calendar dates.
- **Micro Feature Grid (Small Multiples):** Dynamic grid of independent Plotly charts, one per selected Run, for side-by-side waveform comparison.
- **Synchronized Crosshairs:** Hovering over any micro-chart instantly places a crosshair at the same relative X position across all other charts.
- **STFT Parameter Exploration:** Interactive frequency-domain explorer. Brush any time window on the macro chart to instantly compute and display the FFT magnitude spectrum. Lock the window size and generate a full sliding-window spectrogram (time × frequency heatmap in dBFS). Supports 15 window functions (Hann, Hamming, Blackman, etc.) and configurable overlap percentage. CPU-bound computation runs in a `ProcessPoolExecutor` to keep the API event loop non-blocking.
- **Multi-Channel Support:** Wide and stacked CSV formats; one subplot row per channel with independent y-axis scaling and optional physical unit labels.
- **Secure Authentication:** JWT-based registration and login; all signal endpoints are protected.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend language | Python 3.12, FastAPI |
| ORM & database | SQLAlchemy 2.0 (Async) + asyncpg, PostgreSQL 16 |
| Data validation | Pydantic v2 |
| Signal algorithms | NumPy, SciPy (STFT/spectrogram), Polars (classifier, segmenter) |
| Package manager | `uv` |
| Linter / formatter | `ruff` |
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| Visualization | Plotly.js (WebGL / scattergl) |
| HTTP client | Axios |
| Eval / LLM Judge | OpenAI / Anthropic API, Pydantic v2, PyYAML |

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 24+ | Required to run PostgreSQL |
| [uv](https://github.com/astral-sh/uv) | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js + npm | 22 LTS | <https://nodejs.org> |

## Getting Started

### 1. Start the database

PostgreSQL runs in Docker on **port 5433** (avoids conflicts with other local databases on 5432).

```bash
docker compose up -d
```

> Wait a few seconds for the container health-check to pass before running migrations.

### 2. Backend setup

```bash
cd backend

# Install Python dependencies (creates .venv automatically)
uv sync

# Copy the environment template and review it
cp .env.example .env          # defaults work out of the box for local dev

# Apply database migrations
uv run alembic upgrade head

# Start the API server (http://localhost:8000)
uv run uvicorn app.main:app --reload --port 8000
```

The interactive API docs are available at <http://localhost:8000/docs>.

### 3. Frontend setup

Open a **second terminal**:

```bash
cd frontend

# Install Node dependencies
npm install

# Start the Vite dev server (http://localhost:5173)
npm run dev
```

Open <http://localhost:5173> in your browser, register an account, and upload a CSV or Parquet signal file.

### 4. Eval harness (optional — requires an LLM API key)

The LLM-as-a-Judge harness lives in `eval/` and runs locally without any CI setup.

```bash
# Install judge dependencies (Python 3.12+, from repo root)
pip install -r eval/requirements.txt

# Set your LLM provider key (one of these)
export OPENAI_API_KEY=sk-...          # GPT-4o (default model)
# export ANTHROPIC_API_KEY=sk-ant-... # Claude — prefix model with "claude-" in .judge.yml

# Score the last commit against the project rubric
python -m eval.runner \
  --description "Brief description of what this PR does" \
  --base-ref HEAD~1 \
  --head-ref HEAD

# Score a pre-captured diff file
python -m eval.runner --description "Fix STFT window lock" --diff-file changes.diff
```

Set `soft_gate: true` in `eval/.judge.yml` to collect scores without any pass/fail exit code
(recommended for first-time calibration). Scorecards are written to `.judge-scores/` — add
that directory to `.gitignore`.

See [HANDSBOOK.md §13](./HANDSBOOK.md) for full rubric, thresholds, and CI integration guides
(GitHub Actions, Bitbucket Pipelines, GitLab CI).

### Stopping the stack

```bash
docker compose down        # stop postgres (data is preserved in a named volume)
docker compose down -v     # stop and DELETE all data
```

## Project Structure

```
signal-probe/
├── docker-compose.yml          # local PostgreSQL (port 5433)
├── eval/                       # AI agent eval harness (Pillar B: LLM-as-a-Judge)
│   ├── runner.py               # entrypoint: auto-detects GitHub/Bitbucket/GitLab/CLI
│   ├── .judge.yml              # thresholds, model, soft_gate flag
│   ├── judge/                  # platform-agnostic judge core
│   │   ├── core.py             # orchestration: diff → LLM → scorecard → comment
│   │   ├── scorecard.py        # Pydantic v2 schema + weighted overall_score
│   │   ├── rubric.py           # project rules from all 10 ADRs
│   │   ├── prompts.py          # SYSTEM_PROMPT + EVALUATION_TEMPLATE
│   │   └── diff_parser.py      # git diff → ChangeSummary + FileArea classification
│   └── adapters/               # thin CI-platform adapters (ICIAdapter ABC)
│       ├── github.py           # GitHub Actions
│       ├── bitbucket.py        # Bitbucket Pipelines (API 2.0)
│       ├── gitlab.py           # GitLab CI (MR notes API)
│       └── cli.py              # local / Jenkins / any shell
├── backend/
│   ├── app/
│   │   ├── core/               # settings, security, exceptions
│   │   ├── domain/             # pure-Python models, enums, algorithms
│   │   │   ├── signal/         # classifier, segmenter, schemas, format_constants
│   │   │   ├── analysis/       # STFT engine (stft_engine.py), spectral schemas
│   │   │   └── user/
│   │   ├── application/        # use-case services + pipeline orchestrator
│   │   │   ├── signal/         # SignalService, pipeline
│   │   │   └── analysis/       # STFTService (orchestrates engine + storage)
│   │   ├── infrastructure/     # SQLAlchemy repos, storage adapters, executor
│   │   │   └── executor.py     # ProcessPoolExecutor lifecycle (start/stop/get)
│   │   └── presentation/       # FastAPI routers & endpoints
│   │       └── api/v1/endpoints/
│   │           ├── signals.py  # upload, process, macro, runs
│   │           └── analysis.py # GET stft, GET spectrogram
│   ├── alembic/                # database migrations
│   └── pyproject.toml
└── frontend/
    └── src/
        ├── components/
        │   ├── FileUploader.tsx
        │   ├── ColumnConfigPanel.tsx
        │   ├── MultiChannelMacroChart.tsx
        │   ├── MicroChart.tsx
        │   ├── STFTExplorerPanel.tsx   # collapsible STFT section in Dashboard
        │   ├── STFTParamControls.tsx   # window function / overlap / lock controls
        │   ├── FFTSpectrumChart.tsx    # real-time FFT spectrum Plotly chart
        │   └── SpectrogramChart.tsx   # time×freq heatmap Plotly chart
        ├── hooks/
        │   ├── useColumnConfig.ts
        │   └── useSTFTExplorer.ts     # useReducer state machine for STFT flow
        ├── pages/              # Dashboard, Login, Register, SignalsPage
        ├── lib/api.ts          # typed Axios helpers (fetchSTFT, fetchSpectrogram)
        └── types/signal.ts     # TypeScript interfaces (STFTResponse, SpectrogramResponse, …)
```

## Documentation

For architecture decisions, DDD layer rules, API contracts, and the full engineering handbook see [HANDSBOOK.md](./HANDSBOOK.md).

For the AI agent eval harness design (four-pillar quality strategy, LLM judge rubric) see [ai_agent_eval_harness.md](./ai_agent_eval_harness.md).

## CI Quality Gates

| Gate | Trigger | What it checks |
|------|---------|----------------|
| **Deterministic CI** (`ci.yml`) | Every push / PR | `ruff` (backend), `eslint` + `tsc` + `build` (frontend) |
| **LLM Judge** (`llm-judge.yml`) | Every PR to `dev`/`master` | Diff vs. ADR rules → weighted scorecard (instruction 35 %, architecture 40 %, quality 25 %) |

The LLM Judge requires an `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` repository secret. It works with GitHub Actions out of the box and supports Bitbucket Pipelines, GitLab CI, and bare CLI via the adapter pattern — see [HANDSBOOK.md §13](./HANDSBOOK.md) for details.
