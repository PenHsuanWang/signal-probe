# Software Design Document

**Product:** signal-probe
**Feature:** User-Configurable X-Axis Datetime Column & Signal Unit Mapping
**Version:** 1.0
**Date:** 2026-04-23
**Status:** Draft
**Related SRS:** `SRS.md`

---

## Table of Contents

1. [Introduction & Scope](#1-introduction--scope)
2. [System Architecture (HLD)](#2-system-architecture-hld)
3. [Domain-Driven Design Mapping](#3-domain-driven-design-mapping)
4. [Component Design (LLD)](#4-component-design-lld)
   - [4.1 Backend — Schema Layer](#41-backend--schema-layer)
   - [4.2 Backend — Domain Layer](#42-backend--domain-layer)
   - [4.3 Backend — Application Layer: Column Inspector](#43-backend--application-layer-column-inspector)
   - [4.4 Backend — Application Layer: Pipeline](#44-backend--application-layer-pipeline)
   - [4.5 Backend — Application Layer: Service](#45-backend--application-layer-service)
   - [4.6 Backend — Presentation Layer: API Endpoint](#46-backend--presentation-layer-api-endpoint)
   - [4.7 Frontend — Type Definitions](#47-frontend--type-definitions)
   - [4.8 Frontend — Hook: useColumnConfig](#48-frontend--hook-usecolumnconfig)
   - [4.9 Frontend — Component: ColumnConfigPanel](#49-frontend--component-columnconfigpanel)
   - [4.10 Frontend — Component: MultiChannelMacroChart](#410-frontend--component-multichannelmacrochart)
5. [Data Design](#5-data-design)
6. [API Contracts](#6-api-contracts)
7. [UI & Interaction Design](#7-ui--interaction-design)
8. [Technical Specifications & NFRs](#8-technical-specifications--nfrs)

---

## 1. Introduction & Scope

### 1.1 Purpose

This document defines the technical design required to implement two enhancements to the signal-probe column configuration step:

1. **Datetime Column Selection (Stacked Format):** Allow users to explicitly choose which temporal column is used as the x-axis when processing stacked/long-format CSVs, replacing the current hardcoded alias-based detection.
2. **Unit Column Mapping (Both Formats):** Allow users to optionally select a string-typed column whose values name the physical measurement unit per channel. Those units are stored in the processed Parquet and surfaced in the macro-view chart as y-axis titles.

### 1.2 System Boundaries

**In scope:**
- `ProcessSignalRequest` schema — add `datetime_column` and `unit_column` fields.
- `MacroViewResponse` schema — add `channel_units` field.
- `_read_stacked_signal_file` — accept an explicit `datetime_col` parameter.
- `_extract_channel_units` — new pipeline helper.
- `SignalService.process_signal` — validate and pass new fields to pipeline.
- `useColumnConfig` hook — manage new state (`datetimeCol`, `unitCol`).
- `ColumnConfigPanel` — render datetime selector for stacked format, unit column selector for both formats.
- `MultiChannelMacroChart` — apply `channel_units` to y-axis titles.

**Out of scope:**
- Time-unit multiplier for numeric time columns.
- Storing `channel_units` in the SQL `signal_metadata` table.
- Exposing `channel_units` in `RunChunkResponse`.
- Post-processing unit editing.

### 1.3 Stakeholders

| Role | Interest |
|---|---|
| Data analysts | Correct x-axis labels; unit labels on y-axes |
| Data engineers | Reliable column mapping without file pre-editing |
| Frontend developers | New hook state, new UI sub-components |
| Backend developers | Pipeline and schema changes |

---

## 2. System Architecture (HLD)

signal-probe uses a layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React 19 + Vite + Tailwind v4)                       │
│  ┌──────────────────────┐   ┌───────────────────────────────┐   │
│  │  ColumnConfigPanel   │   │  MultiChannelMacroChart       │   │
│  │  (upload step)       │   │  (viz step)                   │   │
│  └──────────┬───────────┘   └──────────────┬────────────────┘   │
│             │ POST /process                  │ GET /macro         │
└─────────────┼──────────────────────────────┼────────────────────┘
              │                               │
┌─────────────▼───────────────────────────────▼────────────────────┐
│  FastAPI  (Presentation Layer)                                    │
│  POST /signals/{id}/process     GET /signals/{id}/macro           │
└─────────────┬───────────────────────────────┬────────────────────┘
              │                               │
┌─────────────▼──────────────┐  ┌─────────────▼────────────────────┐
│  SignalService              │  │  SignalService.get_macro_view     │
│  (Application Layer)        │  │  reads processed Parquet          │
│  - validate columns         │  │  - extracts channel_units         │
│  - queue pipeline task      │  │  - returns MacroViewResponse      │
└─────────────┬───────────────┘  └──────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────────┐
│  Pipeline (Background Task, Application Layer)                  │
│  - _read_stacked_signal_file(datetime_col=…)                    │
│  - _extract_channel_units(unit_col=…)                           │
│  - writes processed Parquet (timestamp_s, channels, units)      │
└─────────────┬──────────────────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────────┐
│  Storage (local filesystem / IStorageAdapter)                   │
│  signals/{id}/raw.csv  →  signals/{id}/processed.parquet        │
└────────────────────────────────────────────────────────────────┘
```

**Key external dependencies:** Polars (data frame processing), FastAPI, SQLAlchemy (async), Plotly.js (chart rendering).

---

## 3. Domain-Driven Design Mapping

### 3.1 Bounded Contexts

| Context | Aggregate Root | Relevant to this Feature |
|---|---|---|
| **Signal Ingestion** | `SignalMetadata` | Stores `datetime_column` and `unit_column` sent by the user |
| **Signal Processing** | `RunSegment` | Pipeline uses `datetime_column` to build x-axis; derives unit map |
| **Signal Visualisation** | `MacroViewResponse` (read-model) | Returns `channel_units` to frontend |

### 3.2 New Domain Events

| Event | Trigger | Payload |
|---|---|---|
| `SignalProcessingQueued` | `POST /signals/{id}/process` called with valid config | `signal_id`, `datetime_column`, `unit_column`, `csv_format` |
| `SignalProcessingCompleted` | Pipeline finishes writing Parquet | `signal_id`, `channel_units` resolved map |

### 3.3 New Value Objects

| Value Object | Location | Description |
|---|---|---|
| `ChannelUnitMap` (conceptual) | Pipeline output / Parquet metadata | `{channel_name: str → unit: str}` — immutable once written |

---

## 4. Component Design (LLD)

### 4.1 Backend — Schema Layer

**File:** `backend/app/domain/signal/schemas.py`

#### 4.1.1 `ProcessSignalRequest` — additions

```python
class ProcessSignalRequest(BaseModel):
    csv_format: Literal["wide", "stacked"] = "wide"

    # ── Wide format ─────────────────────────────────────────────────────────
    time_column: str | None = Field(None, min_length=1, max_length=255)
    signal_columns: list[str] | None = None

    # ── Stacked format ──────────────────────────────────────────────────────
    stacked_channel_filter: list[str] | None = None

    # ── NEW: Stacked format — explicit datetime column ──────────────────────
    datetime_column: str | None = Field(
        None,
        min_length=1,
        max_length=255,
        description=(
            "Name of the temporal column to use as the x-axis for stacked format. "
            "When omitted the pipeline falls back to alias-based auto-detection."
        ),
    )

    # ── NEW: Both formats — optional unit column ────────────────────────────
    unit_column: str | None = Field(
        None,
        min_length=1,
        max_length=255,
        description=(
            "Name of the string column whose values name the physical unit for "
            "each channel. When omitted no unit labels are applied."
        ),
    )

    @model_validator(mode="after")
    def _validate_format_fields(self) -> "ProcessSignalRequest":
        # … existing wide/stacked validation unchanged …

        # New: unit_column must not collide with time or signal columns
        if self.unit_column:
            reserved = set()
            if self.time_column:
                reserved.add(self.time_column)
            if self.datetime_column:
                reserved.add(self.datetime_column)
            if self.signal_columns:
                reserved.update(self.signal_columns)
            if self.unit_column in reserved:
                raise ValueError(
                    "unit_column cannot be the same as the time, datetime, or any signal column"
                )
        return self
```

#### 4.1.2 `MacroViewResponse` — additions

```python
class MacroViewResponse(BaseModel):
    signal_id: uuid.UUID
    x: list[float]
    channels: list[ChannelMacroData]
    runs: list[RunBound]
    t0_epoch_s: float | None = None

    # NEW ─────────────────────────────────────────────────────────────────────
    channel_units: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Map of channel_name → unit string derived from the user-selected "
            "unit column. Empty dict when no unit column was configured."
        ),
    )
```

---

### 4.2 Backend — Domain Layer

**File:** `backend/app/domain/signal/format_constants.py`

No changes required. `STACKED_COL_ALIASES` and `STACKED_REQUIRED_COLS` remain as-is. The new `datetime_column` field bypasses alias resolution entirely when provided.

---

### 4.3 Backend — Application Layer: Column Inspector

**File:** `backend/app/application/signal/column_inspector.py`

No structural changes required. The existing `inspect_columns()` method already returns a `ColumnDescriptor` with `dtype` set to `"string"` for string columns and `"temporal"` for datetime columns, which is all the frontend needs to populate the new selectors.

**Note:** The `detect_csv_format()` method is unchanged. It continues to enumerate `stacked_signal_names` using the existing alias logic. The new `datetime_column` field is supplied by the user and validated server-side in the service layer.

---

### 4.4 Backend — Application Layer: Pipeline

**File:** `backend/app/application/signal/pipeline.py`

#### 4.4.1 `_read_stacked_signal_file` — signature change

```python
def _read_stacked_signal_file(
    df: pl.DataFrame,
    channel_filter: list[str] | None = None,
    datetime_col: str | None = None,      # NEW
) -> tuple[list[float], dict[str, list[float | None]], float]:
```

**Behaviour change:**
- When `datetime_col` is provided, skip `_normalize_stacked_columns` and use the provided column name directly as the pivot index and the source of elapsed-second computation.
- When `datetime_col` is `None`, the existing alias-normalisation logic (`_normalize_stacked_columns`) is applied as before — this preserves backward compatibility.
- Validation: if `datetime_col` is not present in `df.columns`, raise `ValueError(f"datetime_column '{datetime_col}' not found in file")`.

**Pseudocode diff:**

```python
# Before (inside _read_stacked_signal_file):
df = _normalize_stacked_columns(df)
# … uses hardcoded "datetime" as the pivot index key …

# After:
if datetime_col is not None:
    if datetime_col not in df.columns:
        raise ValueError(f"datetime_column '{datetime_col}' not found in file")
    # rename the selected column to the canonical "datetime" for the rest of the function
    if datetime_col != "datetime":
        df = df.rename({datetime_col: "datetime"})
else:
    df = _normalize_stacked_columns(df)
```

#### 4.4.2 `_extract_channel_units` — new helper function

```python
_MAX_UNIT_LEN = 32

def _extract_channel_units(
    df: pl.DataFrame,
    unit_col: str,
    channels: list[str],
    csv_format: Literal["wide", "stacked"],
    signal_name_col: str = "signal_name",
) -> dict[str, str]:
    """Return a per-channel unit map from the raw DataFrame.

    Stacked format:
        For each channel name in *channels*, find the first non-null value
        of *unit_col* where ``signal_name == channel``.

    Wide format:
        The most common non-null value of *unit_col* is used for every
        channel in *channels* (single shared unit).

    Returns:
        ``{channel_name: unit_string}`` — channels with no unit are omitted.
        Unit strings longer than _MAX_UNIT_LEN are truncated with "…".
    """
    if unit_col not in df.columns:
        raise ValueError(f"unit_column '{unit_col}' not found in file")

    def _truncate(s: str) -> str:
        return s if len(s) <= _MAX_UNIT_LEN else s[: _MAX_UNIT_LEN - 1] + "…"

    result: dict[str, str] = {}

    if csv_format == "stacked":
        for ch in channels:
            rows = df.filter(
                (pl.col(signal_name_col) == ch) & pl.col(unit_col).is_not_null()
            )
            if rows.is_empty():
                continue
            unit_val = str(rows[unit_col][0])
            if unit_val.strip():
                result[ch] = _truncate(unit_val)
    else:
        # Wide format: single shared unit (most common non-null value)
        non_null = df[unit_col].drop_nulls().cast(pl.Utf8)
        if non_null.is_empty():
            return result
        counts = non_null.value_counts(sort=True)
        most_common = str(counts["value"][0])
        if most_common.strip():
            for ch in channels:
                result[ch] = _truncate(most_common)

    return result
```

#### 4.4.3 `run_pipeline` — signature and body change

```python
async def run_pipeline(
    signal_id: uuid.UUID,
    raw_path: str,
    session_factory: async_sessionmaker,
    storage: IStorageAdapter,
    csv_format: str = "wide",
    time_column: str | None = None,
    signal_columns: list[str] | None = None,
    stacked_channel_filter: list[str] | None = None,
    datetime_column: str | None = None,    # NEW
    unit_column: str | None = None,        # NEW
) -> None:
```

**Body changes:**
1. Pass `datetime_col=datetime_column` to `_read_stacked_signal_file` for stacked format.
2. After reading timestamps and channels, if `unit_column` is not `None`, call `_extract_channel_units(raw_df, unit_column, list(channels.keys()), csv_format)` to obtain `channel_units`.
3. When writing the processed Parquet, write each unit as a constant column named `__unit_<channel_name>` (prefixed to avoid collision with signal channel names).

**Parquet schema (after this change):**

| Column | Type | Description |
|---|---|---|
| `timestamp_s` | Float64 | Elapsed seconds from first point |
| `t0_epoch_s` | Float64 (constant) | Unix epoch of first point; absent for numeric time axis |
| `<channel_name>` | Float64 | Signal values |
| `<channel_name>_state` | Utf8 | IDLE / ACTIVE / OOC per point |
| `__unit_<channel_name>` | Utf8 (constant) | Unit string; absent when no unit column selected |

---

### 4.5 Backend — Application Layer: Service

**File:** `backend/app/application/signal/service.py`

#### 4.5.1 `process_signal` — extended validation

For **stacked format**, add validation of `datetime_column` and `unit_column`:

```python
# After the existing stacked_channel_filter validation block:

if request.datetime_column:
    df_head = _load_raw_dataframe(signal.file_path).head(1)
    if request.datetime_column not in df_head.columns:
        raise KeyError(
            f"datetime_column '{request.datetime_column}' not found in file"
        )

if request.unit_column:
    df_head = df_head if "df_head" in dir() else _load_raw_dataframe(signal.file_path).head(1)
    if request.unit_column not in df_head.columns:
        raise KeyError(
            f"unit_column '{request.unit_column}' not found in file"
        )
```

For **wide format**, add `unit_column` validation (after existing wide validation):

```python
if request.unit_column:
    if request.unit_column not in file_cols:
        raise KeyError(f"unit_column '{request.unit_column}' not found in file")
    if request.unit_column == request.time_column:
        raise ValueError("unit_column cannot be the same as time_column")
    if request.unit_column in request.signal_columns:
        raise ValueError("unit_column cannot be in signal_columns")
```

Pass new fields to `run_pipeline`:

```python
task = asyncio.create_task(
    run_pipeline(
        signal.id,
        signal.file_path,
        session_factory,
        self.storage,
        csv_format=request.csv_format,
        time_column=request.time_column if request.csv_format == "wide" else None,
        signal_columns=request.signal_columns if request.csv_format == "wide" else None,
        stacked_channel_filter=request.stacked_channel_filter,
        datetime_column=request.datetime_column,   # NEW
        unit_column=request.unit_column,           # NEW
    )
)
```

#### 4.5.2 `get_macro_view` — read `channel_units` from Parquet

```python
# Inside get_macro_view, after reading the Parquet:
channel_units: dict[str, str] = {}
for ch_name in channel_names:
    unit_col_name = f"__unit_{ch_name}"
    if unit_col_name in df.columns:
        val = df[unit_col_name][0]
        if val is not None:
            channel_units[ch_name] = str(val)

return MacroViewResponse(
    signal_id=signal.id,
    x=x,
    channels=channel_data,
    runs=run_bounds,
    t0_epoch_s=t0_epoch_s,
    channel_units=channel_units,   # NEW
)
```

---

### 4.6 Backend — Presentation Layer: API Endpoint

**File:** `backend/app/presentation/api/v1/endpoints/signals.py`

No changes required to endpoint routing or HTTP method. The `process_signal` endpoint already accepts and forwards a `ProcessSignalRequest` body; the new fields are handled transparently by Pydantic. The error-handling block already maps `KeyError` to HTTP 422.

---

### 4.7 Frontend — Type Definitions

**File:** `frontend/src/types/signal.ts`

```typescript
export interface ProcessSignalRequest {
  csv_format?: 'wide' | 'stacked';
  time_column?: string;
  signal_columns?: string[];
  stacked_channel_filter?: string[] | null;
  /** NEW — stacked format: explicit datetime column for x-axis. */
  datetime_column?: string | null;
  /** NEW — both formats: optional unit column for y-axis labels. */
  unit_column?: string | null;
}

export interface MacroViewResponse {
  signal_id: string;
  x: number[];
  channels: ChannelMacroData[];
  runs: RunBound[];
  t0_epoch_s: number | null;
  /**
   * NEW — map of channel_name → unit string.
   * Empty object when no unit column was configured.
   */
  channel_units?: Record<string, string>;
}
```

---

### 4.8 Frontend — Hook: useColumnConfig

**File:** `frontend/src/hooks/useColumnConfig.ts`

#### 4.8.1 State additions

```typescript
interface ColumnConfigState {
  // … existing fields unchanged …

  /** NEW — stacked format: user-selected datetime column name. */
  datetimeCol: string | null;
  /** NEW — both formats: optional unit column name; null = "(none)". */
  unitCol: string | null;
}
```

#### 4.8.2 New action types

```typescript
type Action =
  // … existing actions …
  | { type: 'SET_DATETIME_COL'; payload: string }
  | { type: 'SET_UNIT_COL';     payload: string | null };
```

#### 4.8.3 Reducer changes

**`FETCH_SUCCESS` for stacked format** — auto-select the datetime column:

```typescript
case 'FETCH_SUCCESS': {
  const { csv_format, stacked_signal_names, columns } = action.payload;
  if (csv_format === 'stacked') {
    const temporalCols = columns.filter((c) => c.dtype === 'temporal');
    // Prefer the canonical "datetime" column; fall back to first temporal.
    const defaultDatetime =
      temporalCols.find((c) => c.is_candidate_time)?.name ??
      temporalCols[0]?.name ??
      null;
    return {
      ...state,
      status: 'ready',
      csvFormat: 'stacked',
      columns,
      stackedSignalNames: stacked_signal_names,
      selectedStackedChannels: new Set(stacked_signal_names),
      datetimeCol: defaultDatetime,   // NEW
      unitCol: null,                  // NEW
      timeCol: null,
      sigCols: new Set(),
      fetchError: null,
    };
  }
  // Wide format — unchanged; datetimeCol not used
  // …
}
```

**`SET_DATETIME_COL` and `SET_UNIT_COL`:**

```typescript
case 'SET_DATETIME_COL':
  return { ...state, datetimeCol: action.payload };
case 'SET_UNIT_COL':
  return { ...state, unitCol: action.payload };
```

#### 4.8.4 `canSubmit` change for stacked format

```typescript
const canSubmit =
  state.status === 'ready' &&
  (state.csvFormat === 'stacked'
    ? state.selectedStackedChannels.size > 0 &&
      state.datetimeCol !== null                // NEW: require datetime selection
    : !!state.timeCol &&
      state.sigCols.size > 0 &&
      !state.sigCols.has(state.timeCol));
```

#### 4.8.5 `handleSubmit` change

```typescript
// Inside the stacked branch:
await processSignal(signalId, {
  csv_format: 'stacked',
  stacked_channel_filter: filter,
  datetime_column: state.datetimeCol ?? undefined,    // NEW
  unit_column: state.unitCol ?? undefined,            // NEW
});

// Inside the wide branch:
await processSignal(signalId, {
  csv_format: 'wide',
  time_column: state.timeCol,
  signal_columns: Array.from(state.sigCols),
  unit_column: state.unitCol ?? undefined,            // NEW
});
```

#### 4.8.6 `UseColumnConfigReturn` additions

```typescript
export interface UseColumnConfigReturn {
  // … existing …
  /** NEW — stacked format: selected datetime column. */
  datetimeCol: string | null;
  /** NEW — both formats: selected unit column, or null for "(none)". */
  unitCol: string | null;
  /** NEW — set the datetime column (stacked format). */
  setDatetimeCol: (name: string) => void;
  /** NEW — set or clear the unit column. */
  setUnitCol: (name: string | null) => void;
}
```

---

### 4.9 Frontend — Component: ColumnConfigPanel

**File:** `frontend/src/components/ColumnConfigPanel.tsx`

#### 4.9.1 New `UnitColumnSelector` sub-component

```tsx
interface UnitColumnSelectorProps {
  columns: ColumnDescriptor[];
  excludeNames: Set<string>;    // time/datetime col + signal cols
  selected: string | null;
  labelId: string;
  onChange: (name: string | null) => void;
}

function UnitColumnSelector({
  columns, excludeNames, selected, labelId, onChange,
}: UnitColumnSelectorProps) {
  const stringCols = columns.filter(
    (c) => c.dtype === 'string' && !excludeNames.has(c.name)
  );
  if (stringCols.length === 0) return null;   // hide if no string columns exist

  return (
    <div className="space-y-2" role="radiogroup" aria-labelledby={labelId}>
      <div id={labelId} className="flex items-center gap-1.5"
           style={{ color: 'var(--sp-text-secondary)' }}>
        <Tag size={12} aria-hidden="true" />
        <span className="font-semibold uppercase tracking-wide text-[10px]">
          Unit column
        </span>
        <span className="text-[9px] font-normal ml-1"
              style={{ color: 'var(--sp-text-tertiary)' }}>
          (optional)
        </span>
      </div>

      {/* "(none)" default option */}
      <label className="flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer
                        hover:bg-zinc-800/40 transition-colors">
        <input
          type="radio"
          name={labelId}
          value=""
          checked={selected === null}
          onChange={() => onChange(null)}
          className="accent-blue-500"
          aria-label="No unit column"
        />
        <span className="font-mono text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
          (none)
        </span>
      </label>

      {/* String-typed columns */}
      <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
        {stringCols.map((col) => (
          <label key={col.name}
                 className="flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer
                             hover:bg-zinc-800/40 transition-colors"
                 style={{
                   border: `1px solid ${selected === col.name
                     ? 'var(--sp-brand,#3b82f6)' : 'var(--sp-border)'}`,
                   background: selected === col.name
                     ? 'var(--sp-surface-elevated)' : undefined,
                 }}>
            <input
              type="radio"
              name={labelId}
              value={col.name}
              checked={selected === col.name}
              onChange={() => onChange(col.name)}
              className="accent-blue-500"
              aria-label={col.name}
            />
            <div className="min-w-0">
              <span className="font-mono font-semibold text-xs truncate"
                    style={{ color: 'var(--sp-text-primary)' }}>
                {col.name}
              </span>
              {col.sample_values.length > 0 && (
                <span className="ml-1 text-[10px] font-mono opacity-60"
                      style={{ color: 'var(--sp-text-tertiary)' }}>
                  e.g. {col.sample_values.slice(0, 2).join(', ')}
                </span>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
```

#### 4.9.2 `ColumnConfigPanel` main component changes

**Stacked format panel** — add `TimeColumnSelector` above `StackedChannelPicker`:

```tsx
{csvFormat === 'stacked' ? (
  <div className="space-y-4">
    {/* NEW: datetime column selector for stacked format */}
    <TimeColumnSelector
      columns={columns.filter((c) => c.dtype === 'temporal')}
      selected={datetimeCol}
      radioGroupName={`datetime-col-${uid}`}
      labelId={`${uid}-datetime-label`}
      onSelect={setDatetimeCol}
    />
    {/* Existing: channel picker */}
    <StackedChannelPicker … />
    {/* NEW: unit column selector */}
    <UnitColumnSelector
      columns={columns}
      excludeNames={new Set([datetimeCol ?? '', ...selectedStackedChannels])}
      selected={unitCol}
      labelId={`${uid}-unit-label`}
      onChange={setUnitCol}
    />
  </div>
) : (
  /* Wide format */
  <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <TimeColumnSelector … />
      <SignalColumnSelector … />
    </div>
    {/* NEW: unit column selector */}
    <UnitColumnSelector
      columns={columns}
      excludeNames={new Set([timeCol ?? '', ...sigCols])}
      selected={unitCol}
      labelId={`${uid}-unit-label`}
      onChange={setUnitCol}
    />
  </div>
)}
```

**Inline validation** — add collision guard:

```tsx
{unitCol && (
  (csvFormat === 'wide' && sigCols.has(unitCol)) ||
  (csvFormat === 'stacked' && selectedStackedChannels.has(unitCol))
) && (
  <div role="alert" className="flex items-center gap-1.5 text-yellow-400 text-[10px]">
    <AlertCircle size={11} aria-hidden="true" />
    Unit column cannot be a signal channel. Deselect it.
  </div>
)}
```

---

### 4.10 Frontend — Component: MultiChannelMacroChart

**File:** `frontend/src/components/MultiChannelMacroChart.tsx`

**Change:** Use `macro.channel_units?.[ch.channel_name] ?? ''` as the `title.text` for each y-axis layout object:

```typescript
// Inside the layout useMemo:
channels.forEach((ch, i) => {
  const axKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
  l[axKey] = {
    // … existing properties unchanged …
    title: {
      text: macro.channel_units?.[ch.channel_name] ?? '',   // CHANGED
      font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
    },
  };
});
```

No other changes to this component.

---

## 5. Data Design

### 5.1 Processed Parquet Schema (after this feature)

The processed Parquet written by the pipeline gains optional `__unit_<channel_name>` constant columns:

| Column name | Polars dtype | Always present? | Description |
|---|---|---|---|
| `timestamp_s` | `Float64` | ✅ | Elapsed seconds from first data point |
| `t0_epoch_s` | `Float64` | Only for temporal time columns | Unix epoch of first point |
| `<channel_name>` | `Float64` | ✅ | Signal values for this channel |
| `<channel_name>_state` | `Utf8` | ✅ | `IDLE` / `ACTIVE` / `OOC` per point |
| `__unit_<channel_name>` | `Utf8` | Only when `unit_column` was configured | Constant unit string, same value every row |

**Design rationale:** Storing units as constant columns in the Parquet (rather than Parquet metadata/schema-level key-value pairs) keeps the read path simple: `df["__unit_signal_1"][0]` always returns the unit string without parsing custom metadata blobs.

### 5.2 SQL Schema

No changes to the `signal_metadata` or `run_segments` tables. The `datetime_column` and `unit_column` are transient configuration inputs; only their outputs (the processed Parquet content and `channel_names`) are persisted.

### 5.3 Data Flow

```
User selects datetime_column="event_time", unit_column="unit"
  │
  ▼
POST /signals/{id}/process
  ├─ Server validates column names exist in raw file (head(1) read)
  ├─ Queues run_pipeline(… datetime_column="event_time", unit_column="unit")
  │
  ▼  [Background Task]
run_pipeline()
  ├─ _load_raw_dataframe(raw_path)           → full DataFrame
  ├─ _read_stacked_signal_file(df,
  │     datetime_col="event_time")           → timestamps_s, channels, t0_epoch_s
  ├─ _extract_channel_units(df,
  │     unit_col="unit",
  │     channels=["signal_1","signal_2"],
  │     csv_format="stacked")               → {"signal_1":"mV","signal_2":"°C"}
  ├─ classifier + segmenter                  → states + run segments
  └─ write Parquet(
         timestamp_s, t0_epoch_s,
         signal_1, signal_1_state,
         __unit_signal_1 = "mV",            ← constant column
         signal_2, signal_2_state,
         __unit_signal_2 = "°C"             ← constant column
     )

GET /signals/{id}/macro
  ├─ read Parquet
  ├─ extract channel_units from __unit_* columns
  └─ return MacroViewResponse(
         …,
         channel_units={"signal_1":"mV","signal_2":"°C"}
     )

Frontend MultiChannelMacroChart
  └─ yaxis.title.text = channel_units["signal_1"] → "mV"
```

---

## 6. API Contracts

### 6.1 `GET /api/v1/signals/{signal_id}/raw-columns`

**No changes.** Response already includes all columns with `dtype` set to `"temporal"`, `"numeric"`, `"string"`, or `"boolean"`. Frontend uses this to populate the new selectors.

### 6.2 `POST /api/v1/signals/{signal_id}/process`

**Request body changes (backward-compatible additions):**

```jsonc
// Stacked format with new fields
{
  "csv_format": "stacked",
  "stacked_channel_filter": ["signal_1", "signal_2"],
  "datetime_column": "event_time",   // NEW — optional; omit to use alias detection
  "unit_column": "unit"              // NEW — optional; omit for no unit labels
}

// Wide format with new unit_column field
{
  "csv_format": "wide",
  "time_column": "timestamp",
  "signal_columns": ["sensor_a", "sensor_b"],
  "unit_column": "measurement_unit"  // NEW — optional
}
```

**Error responses (new cases):**

| HTTP | Condition |
|---|---|
| `422` | `datetime_column` name not found in the file |
| `422` | `unit_column` name not found in the file |
| `422` | `unit_column` same as `time_column`, `datetime_column`, or any signal column |

### 6.3 `GET /api/v1/signals/{signal_id}/macro`

**Response body changes (backward-compatible addition):**

```jsonc
{
  "signal_id": "...",
  "x": [0.0, 1.0, 2.0],
  "channels": [...],
  "runs": [...],
  "t0_epoch_s": 1745000000.0,
  "channel_units": {              // NEW — empty object {} when no units configured
    "signal_1": "mV",
    "signal_2": "°C"
  }
}
```

---

## 7. UI & Interaction Design

### 7.1 Key User Journeys

#### 7.1.1 Stacked format with custom datetime column and units

```
1. User uploads a stacked CSV (columns: measurement_time, signal_name, signal_value, unit)
2. UI: ColumnConfigPanel renders in "Stacked / Long format" mode
3. UI: "Datetime axis column" radio-group shows [measurement_time ★suggested]
   → User confirms measurement_time (pre-selected)
4. UI: "Signal channels" checkbox list shows [signal_1 ✓, signal_2 ✓]
5. UI: "Unit column (optional)" radio-group shows [(none), unit]
   → User selects "unit"
   → Inline preview appears: "signal_1 → mV  •  signal_2 → °C"
6. User clicks "Process Signal"
7. Frontend calls POST /process with datetime_column="measurement_time", unit_column="unit"
8. Pipeline processes file; chart renders with "mV" on signal_1 y-axis, "°C" on signal_2
```

#### 7.1.2 Wide format with unit column

```
1. User uploads a wide CSV (columns: ts, sensor_a, sensor_b, eng_unit)
2. UI: ColumnConfigPanel renders in "Wide format" mode
3. User selects: time column = ts; signal channels = [sensor_a, sensor_b]
4. UI: "Unit column (optional)" shows [(none), eng_unit]
   → User selects "eng_unit"
5. User clicks "Process Signal"
6. Frontend calls POST /process with unit_column="eng_unit"
7. Chart renders with the most common eng_unit value on all y-axes
```

#### 7.1.3 User skips unit column (default behaviour unchanged)

```
1. User uploads any CSV
2. ColumnConfigPanel renders with "Unit column (optional)" section
3. User leaves selection at "(none)" (default)
4. User submits → POST /process called without unit_column field
5. Processing is identical to existing behaviour; chart y-axes show blank titles
```

### 7.2 Component Tree (affected portion)

```
ColumnConfigPanel
├─ [stacked] ─── DatetimeColumnSelector   ← NEW (reuses TimeColumnSelector, temporal cols only)
│  ├─ [stacked] ─ StackedChannelPicker    (unchanged)
│  └─ [both]  ─── UnitColumnSelector      ← NEW
│
└─ [wide] ──────── grid
   ├── TimeColumnSelector                 (unchanged)
   ├── SignalColumnSelector               (unchanged)
   └── UnitColumnSelector                 ← NEW
```

### 7.3 State Management

All new state is managed inside the existing `useColumnConfig` hook using the existing `useReducer` pattern. No new contexts or global stores are required.

| State field | Type | Initial value | Updated by |
|---|---|---|---|
| `datetimeCol` | `string \| null` | `null` | `FETCH_SUCCESS` (auto-select), `SET_DATETIME_COL` |
| `unitCol` | `string \| null` | `null` | `SET_UNIT_COL` |

---

## 8. Technical Specifications & NFRs

| Concern | Decision |
|---|---|
| **Performance — unit extraction** | `_extract_channel_units` iterates once per channel using Polars filter+head(1). For stacked CSVs with N channels and R rows, complexity is O(N × R) worst case but Polars executes this in a single scan via lazy evaluation if needed. Target: ≤ 50 ms for 100 000 rows. |
| **Backward compatibility — API** | All new fields are optional with sensible defaults. Existing callers receive `channel_units: {}` in macro responses without any code change. |
| **Backward compatibility — Parquet** | `get_macro_view` checks `if "__unit_{ch_name}" in df.columns` before reading; missing columns return an empty unit map. |
| **Security — unit string** | Unit strings from the CSV are truncated to 32 characters and rendered as plain text in Plotly axis titles (not as HTML), preventing any injection via crafted CSV content. |
| **Testing** | New backend unit tests cover: (a) `_read_stacked_signal_file` with `datetime_col` parameter; (b) `_extract_channel_units` for both stacked and wide format; (c) partial/null units; (d) `process_signal` validation errors for missing/colliding columns. Frontend tests cover: (a) reducer transitions for `SET_DATETIME_COL` / `SET_UNIT_COL`; (b) `canSubmit` with missing `datetimeCol`; (c) `handleSubmit` payload shape. |
| **Accessibility** | New radio-groups use `role="radiogroup"` + `aria-labelledby`. The `UnitColumnSelector` is hidden (`return null`) when no eligible string columns exist, avoiding an empty form section. |
| **Scalability** | No new database queries are added. The unit extraction reads from the already-loaded raw DataFrame and adds a fixed number of constant columns to the output Parquet, with no impact on query performance. |
