"""
Project-specific evaluation rubric extracted from HANDSBOOK.md, ARCHITECTURE.md,
and the ADRs (ADR-001 through ADR-010).

Each constant is a string block injected verbatim into the judge prompt.
Keep these in sync with the living documentation.
"""

# ── Backend invariants ─────────────────────────────────────────────────────────

BACKEND_INVARIANTS = """
=== BACKEND ARCHITECTURAL RULES ===
Deduct 1 point from architectural_alignment per violation found.

[Domain Layer Purity — HANDSBOOK §4.2]
- Files under app/domain/ must have ZERO imports from: fastapi, starlette,
  sqlalchemy, alembic, or any framework package.
- Domain entities and algorithms are pure Python with zero outer-layer imports.
- app/domain/analysis/stft_engine.py uses only numpy and scipy — no business
  logic, no I/O, no framework.

[Exception Hierarchy — ADR-007]
- The ONLY allowed exception classes are:
    DomainException (base, abstract)
      ├── NotFoundException   → HTTP 404
      ├── ConflictException   → HTTP 409  (wrong state, duplicate resource)
      └── ValidationException → HTTP 422  (bad input, path traversal, unknown column)
    InfrastructureException   → HTTP 500  (DB/storage faults, always logged)
- Application layer (app/application/) raises only DomainException subclasses.
  Never raises HTTPException, ValueError, KeyError, or LookupError.
- Infrastructure (app/infrastructure/):
    IntegrityError     → ConflictException
    SQLAlchemyError    → InfrastructureException  (with session.rollback())
    OSError / FileNotFoundError → InfrastructureException
    Path traversal     → ValidationException
- Presentation endpoints (app/presentation/) contain ZERO try/except blocks
  for domain errors. All exceptions bubble to app/main.py global handlers.
- New exception types must extend the existing hierarchy; never invent new ones.

[Storage Adapter Pattern — ADR-001]
- All file I/O goes through IStorageAdapter.
- Never call open(), pathlib.Path.write_*, os.path, or shutil directly in
  domain/ or application/ layers.
- Swapping LocalStorageAdapter → MinIOStorageAdapter must require zero changes
  to any application or domain code.

[Concurrency — ADR-010]
- CPU-bound work (FFT, heavy NumPy) must use:
    asyncio.get_running_loop().run_in_executor(get_executor(), fn, *args)
- Never call scipy or numpy compute functions directly inside an async def
  without run_in_executor — this blocks the event loop.
- Worker lifecycle (start_executor / stop_executor) is managed in FastAPI
  lifespan only; not called from service code.

[Data Storage — ADR-003 / ADR-008]
- Bulk float time-series data goes to Parquet files — NOT SQL rows.
- Pipeline-derived metadata (e.g., channel units) goes to constant Parquet
  columns prefixed with __unit_<name> — NOT new SQL columns on signal_metadata.
- Adding a JSONB column to signal_metadata for pipeline artifacts is a violation.

[API Contracts]
- Every new API request model must be a Pydantic v2 BaseModel.
- Every new API response model must be a Pydantic v2 BaseModel.
- Response envelope for errors: {"error": {"code": "...", "message": "...", "timestamp": "ISO8601"}}
- updated_at in SQL UPDATEs must be set explicitly as updated_at = func.now()
  (SQLAlchemy onupdate does not fire on Core SQL updates).

[Type Safety]
- All new Python functions must have complete type hints (parameters + return type).
- No bare `Any` without an inline comment justifying the exception.
- Pydantic v2 model fields must use explicit types, not `Any`.

[Two-Step Upload Flow — ADR-005]
- Signal status transitions: AWAITING_CONFIG → PENDING → PROCESSING → COMPLETED | FAILED.
- The /process endpoint must validate status == AWAITING_CONFIG before starting the pipeline.
  Wrong-state attempts must raise ConflictException.
"""

# ── Frontend invariants ────────────────────────────────────────────────────────

FRONTEND_INVARIANTS = """
=== FRONTEND ARCHITECTURAL RULES ===
Deduct 1 point from architectural_alignment per violation found.

[TypeScript]
- No `any` type annotations. Use `unknown` + type guards, or precise interfaces.
- All React component props must have an explicit TypeScript interface or type alias.
- Axios error handling: type catch variable as `unknown`, narrow with type guard
  (not `catch (err: any)`).

[React Patterns]
- useMemo returns VALUES. useCallback returns FUNCTIONS.
  Never use useMemo to return a function — use useCallback.
- Refs must NOT be written during the render body:
    BAD:  ref.current = value;          // inside component body
    GOOD: useEffect(() => { ref.current = value; });
- Never call setState synchronously inside a useEffect body without an explicit
  // eslint-disable-next-line react-hooks/set-state-in-effect comment and justification.
- Complex state machines use useReducer (see useSTFTExplorer, useColumnConfig).
- Context files that export both a Provider component and a hook must suppress
  react-refresh with: // eslint-disable-next-line react-refresh/only-export-components
- Dependency arrays must be complete. Do not suppress exhaustive-deps without justification.

[Design System — HANDSBOOK §4.1]
- Dark theme surfaces: zinc-950 (primary) / zinc-900 (secondary) / zinc-800 (elevated).
- Brand colours: use brand-400 / brand-500 tokens from index.css @theme ONLY.
  No hardcoded brand hex values (e.g., #6366f1).
- Typography: JetBrains Mono for all axis labels, data readouts, and code.
- All chart layouts must start from buildChartTheme(theme) from src/lib/chartTheme.ts.
  Never inline color constants in chart layout objects.

[Charts]
- Time-series Plotly traces must use type: 'scattergl' (WebGL, GPU-accelerated).
  Never use type: 'scatter' for any time-series data.
- OOC anomaly markers: colour #ef4444 (deep red) exclusively.
- No decorative chart elements: no drop shadows, no gradients, no rounded bars.
- Spectrogram heatmaps use colorscale: 'Viridis' with dBFS colour axis.
- Every chart component must handle the loading=true and error != null states
  (no blank white boxes on failure).

[State & Data Flow]
- API calls go through src/lib/api.ts (the Axios instance with JWT injection).
  Never use raw fetch() or create a new Axios instance in a component.
- Shared StatusBadge from src/components/StatusBadge.tsx for signal status display.
  Do not inline status badge styles in individual components.
"""

# ── UI vibe rules (Pass/Fail) ─────────────────────────────────────────────────

VIBE_RULES = """
=== UI VIBE CHECK (Pass / Fail) ===
This is a holistic assessment of whether the UI changes feel consistent
with the existing signal-probe design language.

Pass criteria (ALL must hold for vibe_check.passed = true):
1. The new UI feels like it belongs in a precision engineering / scientific tool.
   No consumer-app aesthetics: no large card shadows, no pastel colours,
   no rounded-3xl/rounded-full buttons, no animated gradients.
2. New Plotly charts visually match the existing dark/monospace chart style.
3. Loading and error states are handled — no blank areas on fetch failure.
4. Layout is responsive — no hardcoded pixel widths that break on narrower screens.
5. New text labels, axis titles, and units use the JetBrains Mono font stack.

Automatic fail:
- A new component hardcodes a background colour that ignores the CSS token system
  (--sp-surface-primary / --sp-surface-secondary / --sp-surface-elevated).
- A new chart uses svg scatter instead of scattergl.
- Decorative animations (fade-in, slide-in) added to data components (not modals/toasts).
"""
