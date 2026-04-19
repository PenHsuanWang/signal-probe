# Signal Probe

**Signal Probe** is a Time-Series Signal Intelligent Exploration Engineering Platform. It is designed to eliminate the "getting lost" feeling for data scientists and process engineers when navigating massive machine time-series data.

By automating feature extraction and leveraging a Macro-Micro visualization architecture, the platform transforms long-cycle raw signals into instantly comparable micro-engineering insights, significantly accelerating anomaly root-cause analysis.

## Features

- **Automated State Classification & Run Segmentation:** Automatically tags time-series data as `IDLE`, `ACTIVE`, or `OOC` (Out of Control) and groups continuous active periods into independent "Runs".
- **Macro Timeline Navigation:** Global overview of the entire dataset using LTTB downsampling for high-performance rendering. Includes a brush tool for time range selection.
- **Micro Feature Grid (Small Multiples):** Dynamic grid of independent charts for selected Runs, allowing side-by-side comparison of waveforms.
- **Synchronized Crosshairs:** Hovering over one micro-chart synchronously displays crosshairs and tooltips across all other charts for instant visual anomaly correlation.
- **Secure Authentication:** Custom JWT-based user registration and login system.

## Technology Stack

### Backend
- **Language:** Python 3.12
- **Framework:** FastAPI
- **ORM & Database:** SQLAlchemy 2.0 (Async), PostgreSQL
- **Data Validation:** Pydantic v2
- **Package Manager:** `uv`
- **Linting & Formatting:** `ruff`

### Frontend
- **Framework:** React 19, Vite
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **Visualization:** Plotly.js (WebGL rendering)
- **Routing & State:** React Router, Context API

## Getting Started

### Prerequisites
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- Node.js (v20+) and npm
- PostgreSQL

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   uv sync
   ```
3. Run database migrations (ensure PostgreSQL is running and configured):
   ```bash
   uv run alembic upgrade head
   ```
4. Start the development server:
   ```bash
   uv run uvicorn app.main:app --reload --port 8000
   ```

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

## Documentation
For deeper insights into the system architecture, DDD implementation, and operational flows, please refer to the [HANDSBOOK.md](./HANDSBOOK.md).
