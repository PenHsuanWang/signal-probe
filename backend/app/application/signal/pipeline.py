"""PipelineOrchestrator: reads raw file → classify → segment → persist.

Runs as a FastAPI BackgroundTask (ADR-002).

Supported input formats
-----------------------
Wide format (existing):
    First column = time axis (numeric or temporal); remaining columns = channels.
    Example: timestamp, sensor_a, sensor_b

Long / stacked format (new):
    Three columns: datetime, signal_name, signal_value.
    All channels are appended sequentially. Detected automatically via column names.
    Example rows:
        2026-04-20 00:00:00, signal_1, 0.12
        2026-04-20 00:01:00, signal_1, 0.34
        ...
        2026-04-20 00:00:00, signal_2, -0.05

User-configured format (EPIC-FLX):
    Caller explicitly provides time_column and signal_columns.  The auto-detection
    heuristics are bypassed entirely; only the specified columns are processed.
"""

import io
import logging
import os
import uuid

import polars as pl

from app.domain.signal.algorithms import classifier, segmenter
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.format_constants import (
    STACKED_COL_ALIASES,
    STACKED_REQUIRED_COLS,
)
from app.domain.signal.repository import SignalRepository
from app.infrastructure.storage.interface import IStorageAdapter

logger = logging.getLogger(__name__)

# Maximum characters stored per unit string (guards against XSS via Plotly titles).
_UNIT_MAX_LEN = 32

# ── Format detection ──────────────────────────────────────────────────────────

# Canonical constants live in format_constants; bind local aliases for brevity.
_STACKED_REQUIRED_COLS = STACKED_REQUIRED_COLS
_STACKED_COL_ALIASES = STACKED_COL_ALIASES


def _normalize_stacked_columns(df: pl.DataFrame) -> pl.DataFrame:
    """Lower-case all column names and resolve known stacked-format aliases.

    Applies :data:`_STACKED_COL_ALIASES` so that variant column names such as
    ``measurement_datetime`` and ``measurement_value`` are mapped to the
    canonical names ``datetime`` and ``signal_value`` before any further
    processing.  Extra columns (e.g. ``equipment``, ``unit``) are preserved
    unchanged and will be dropped implicitly by the downstream pivot.
    """
    rename_map: dict[str, str] = {}
    for c in df.columns:
        target = _STACKED_COL_ALIASES.get(c.lower(), c.lower())
        if target != c:
            rename_map[c] = target
    return df.rename(rename_map) if rename_map else df


def _is_stacked_format(df: pl.DataFrame) -> bool:
    """Return True when *df* has the canonical long/stacked-format columns.

    Detection is case-insensitive and resolves known column-name aliases
    (e.g. ``measurement_datetime`` → ``datetime``); extra columns are ignored.
    """
    normalised = {_STACKED_COL_ALIASES.get(c.lower(), c.lower()) for c in df.columns}
    return _STACKED_REQUIRED_COLS.issubset(normalised)


def _extract_channel_units(
    df: pl.DataFrame,
    unit_col: str,
    channels: dict[str, list],
    csv_format: str,
) -> dict[str, str]:
    """Extract per-channel physical unit strings from *unit_col*.

    For **wide** format the unit column contains one value per row (all channels
    typically share the same unit).  The statistical mode of non-null values is
    computed and applied to every channel.

    For **stacked** format the raw pre-pivot DataFrame still has a
    ``signal_name`` column.  We group by ``signal_name`` and take the first
    non-null unit value per channel.

    Column names are normalised (lower-case + alias resolution) before lookup so
    that variant names such as ``Unit`` or ``UNIT`` are found reliably.

    Unit strings are truncated to :data:`_UNIT_MAX_LEN` characters.

    Args:
        df: Raw (pre-pivot) DataFrame containing *unit_col* and, for stacked
            format, a ``signal_name`` column.
        unit_col: Name of the column holding unit strings (user-supplied,
            original casing).
        channels: ``{channel_name: values}`` dict returned by the reader; used
            to restrict the result to channels that were actually processed.
        csv_format: ``"stacked"`` or ``"wide"`` (any non-stacked value is
            treated as wide).

    Returns:
        ``{channel_name: unit_string}`` for every processed channel that has a
        non-null unit entry.  Empty dict when *unit_col* is absent or all values
        are null.
    """
    norm_df = _normalize_stacked_columns(df)
    norm_unit = _STACKED_COL_ALIASES.get(unit_col.lower(), unit_col.lower())
    if norm_unit not in norm_df.columns:
        return {}

    result: dict[str, str] = {}
    if csv_format == "stacked":
        if "signal_name" not in norm_df.columns:
            return {}
        unit_per_channel = (
            norm_df.filter(pl.col(norm_unit).is_not_null())
            .group_by("signal_name")
            .agg(pl.col(norm_unit).first().alias("unit"))
        )
        for row in unit_per_channel.iter_rows(named=True):
            ch_name = row["signal_name"]
            if ch_name in channels:
                result[ch_name] = str(row["unit"])[:_UNIT_MAX_LEN]
    else:
        non_null = norm_df[norm_unit].drop_nulls()
        if non_null.is_empty():
            return {}
        mode_val = non_null.mode()[0]
        unit_str = str(mode_val)[:_UNIT_MAX_LEN]
        for ch_name in channels:
            result[ch_name] = unit_str

    return result


# ── Raw file loader ───────────────────────────────────────────────────────────


def _load_raw_dataframe(raw_path: str) -> pl.DataFrame:
    """Load a CSV or Parquet file into a Polars DataFrame."""
    ext = os.path.splitext(raw_path)[1].lower()
    if ext in (".parquet", ".pq"):
        return pl.read_parquet(raw_path)
    return pl.read_csv(raw_path, infer_schema_length=500, try_parse_dates=True)


# ── Stacked-format reader ─────────────────────────────────────────────────────


def _read_stacked_signal_file(
    df: pl.DataFrame,
    channel_filter: list[str] | None = None,
    datetime_col: str | None = None,
) -> tuple[list[float], dict[str, list[float | None]], float]:
    """Parse a long/stacked CSV into (timestamps_s, channels, t0_epoch_s).

    Steps
    -----
    1. If *datetime_col* is provided, rename it to the canonical ``datetime``
       name before any further processing so user-selected column names (e.g.
       ``ts_utc``, ``event_time``) are handled transparently.
    2. Normalise column names to lower-case.
    3. Cast ``signal_value`` to Float64; drop rows with null in key columns.
    4. Pivot on ``signal_name`` → wide DataFrame (outer-join semantics;
       missing positions become ``null``).
    5. Sort by ``datetime`` and compute elapsed seconds from the first timestamp.
    6. Apply *channel_filter* if provided (keep only the requested channels).
    7. Return ``(timestamps_s, {signal_name: [float | None, ...]}, t0_epoch_s)``
       where ``None`` marks timestamps absent for a given channel and
       ``t0_epoch_s`` is the Unix epoch of the first timestamp (seconds).

    Args:
        df: Raw DataFrame loaded from the stacked CSV.
        channel_filter: Optional list of signal names to include.  When
            ``None`` (default) all channels are included.  Names not present
            in the file are silently ignored after pivoting.
        datetime_col: Optional user-selected column name to use as the datetime
            axis.  When provided, the column is renamed to ``datetime`` before
            the canonical normalization step.  When ``None`` (default), the
            existing alias-based detection is used.

    Returns:
        timestamps_s: Elapsed-seconds list starting at 0.0.
        channels: Ordered dict ``{signal_name: [float | None, ...]}``,
                  all lists parallel to ``timestamps_s``.
        t0_epoch_s: Unix epoch seconds of the first (earliest) timestamp.

    Raises:
        ValueError: If the DataFrame is empty after cleaning or has no channels.
    """
    # If the user explicitly selects a datetime column, rename it to the
    # canonical name so that downstream normalization and pivot logic work
    # without modification.  Match original casing first, then lower-case.
    if datetime_col is not None and datetime_col != "datetime":
        if datetime_col in df.columns:
            df = df.rename({datetime_col: "datetime"})
        elif datetime_col.lower() in df.columns and datetime_col.lower() != "datetime":
            df = df.rename({datetime_col.lower(): "datetime"})

    # Normalise column names: lower-case + resolve known aliases
    # (e.g. measurement_datetime → datetime, measurement_value → signal_value)
    df = _normalize_stacked_columns(df)

    df = df.with_columns(pl.col("signal_value").cast(pl.Float64)).drop_nulls(
        subset=["datetime", "signal_name", "signal_value"]
    )

    if df.is_empty():
        raise ValueError("Stacked CSV contains no valid rows after cleaning.")

    # Pivot: long → wide (null for each (datetime, signal_name) combination
    # that has no row in the input — outer-join alignment is automatic).
    # aggregate_function="first" deduplicates rows with the same (datetime,
    # signal_name) by keeping the earliest occurrence.
    aligned = df.pivot(
        values="signal_value",
        index="datetime",
        on="signal_name",
        aggregate_function="first",
    ).sort("datetime")

    ch_cols = sorted(c for c in aligned.columns if c != "datetime")
    if not ch_cols:
        raise ValueError("Stacked CSV contains no signal channels after pivoting.")

    # Apply optional channel filter — keep only requested names that exist.
    if channel_filter is not None:
        filter_set = set(channel_filter)
        filtered_cols = [c for c in ch_cols if c in filter_set]
        if not filtered_cols:
            raise ValueError(
                "None of the requested channel names were found in the stacked CSV."
            )
        ch_cols = filtered_cols

    # Compute elapsed seconds (Float64) from the first timestamp.
    # Polars stores Datetime as int64 microseconds; dividing by 1e6 gives seconds.
    t0 = aligned["datetime"].min()
    elapsed = (aligned["datetime"] - t0).dt.total_microseconds().cast(pl.Float64)
    timestamps_s: list[float] = (elapsed / 1_000_000.0).to_list()

    # Extract the Unix epoch of the first timestamp so callers can reconstruct
    # absolute datetime values for axis display.
    t0_epoch_us: int = aligned["datetime"].cast(pl.Int64).min()  # type: ignore[assignment]
    t0_epoch_s: float = t0_epoch_us / 1_000_000.0

    channels: dict[str, list[float | None]] = {
        col: aligned[col].to_list() for col in ch_cols
    }
    return timestamps_s, channels, t0_epoch_s


# ── Shared temporal-time-column helper ───────────────────────────────────────


def _parse_temporal_time_column(
    df: pl.DataFrame,
    time_col: str,
    signal_cols: list[str],
) -> tuple[list[float], dict[str, list[float]], float]:
    """Convert a temporal time column to elapsed seconds and extract channels.

    Shared by :func:`_read_wide_signal_file` and :func:`_read_with_config` to
    avoid duplicating the microsecond-precision epoch arithmetic.

    Args:
        df: DataFrame already filtered to ``[time_col, *signal_cols]`` with
            signal columns cast to Float64 and nulls dropped.
        time_col: Name of the temporal column (must be a Polars temporal dtype).
        signal_cols: Names of the signal value columns.

    Returns:
        timestamps_s: Elapsed-seconds list starting at 0.0.
        channels: ``{channel_name: [float, ...]}`` parallel to ``timestamps_s``.
        t0_epoch_s: Unix epoch seconds of the first (earliest) timestamp.

    Notes:
        We cast to ``Int64`` (microseconds since epoch) rather than using
        ``.dt.total_seconds()`` because the latter truncates sub-second
        precision to whole seconds.
    """
    epoch_us_series = df[time_col].cast(pl.Int64)
    t0_epoch_us: int = epoch_us_series[0]  # type: ignore[assignment]
    timestamps_s: list[float] = [
        (t - t0_epoch_us) / 1_000_000.0 for t in epoch_us_series.to_list()
    ]
    t0_epoch_s: float = t0_epoch_us / 1_000_000.0
    channels: dict[str, list[float]] = {c: df[c].to_list() for c in signal_cols}
    return timestamps_s, channels, t0_epoch_s


# ── Wide-format reader (existing logic, extracted) ────────────────────────────


def _read_wide_signal_file(
    df: pl.DataFrame,
) -> tuple[list[float], dict[str, list[float]], float | None]:
    """Parse a wide-format CSV/Parquet into (timestamps_s, channels, t0_epoch_s).

    The first numeric/temporal column is treated as the time axis; all
    remaining numeric columns are value channels.

    Returns:
        timestamps_s: Elapsed-seconds list (first point = 0.0).
        channels: ``{channel_name: [float, ...]}`` parallel to ``timestamps_s``.
        t0_epoch_s: Unix epoch seconds of the first timestamp when the time
            column is temporal; ``None`` for purely numeric time columns.
    """
    numeric_cols = [
        c for c, t in zip(df.columns, df.dtypes) if t.is_numeric() or t.is_temporal()
    ]

    if len(numeric_cols) < 1:
        raise ValueError("File contains no usable numeric columns.")

    if len(numeric_cols) == 1:
        # Only one column — use row index as time axis
        value_col = numeric_cols[0]
        ts_series = pl.Series("ts", list(range(len(df)))).cast(pl.Float64)
        val_series = df[value_col].cast(pl.Float64)
        df = pl.DataFrame({"ts": ts_series, value_col: val_series}).drop_nulls()
        time_col = "ts"
        ch_cols = [value_col]
    else:
        # First column is the time axis; remaining are value channels
        time_col = numeric_cols[0]
        ch_cols = numeric_cols[1:]

    time_dtype = df[time_col].dtype if time_col in df.columns else None
    if time_dtype is not None and time_dtype.is_temporal():
        # Temporal time column: cast signal channels to Float64, keep time as-is
        ch_cast = [pl.col(c).cast(pl.Float64) for c in ch_cols]
        df = df.select([time_col, *ch_cols]).with_columns(ch_cast).drop_nulls()

        if df.is_empty():
            raise ValueError(
                "File contains no valid numeric data points after cleaning."
            )

        timestamps_s, channels, t0_epoch_s = _parse_temporal_time_column(
            df, time_col, ch_cols
        )
        return timestamps_s, channels, t0_epoch_s
    else:
        # Numeric time column: cast everything to Float64
        cast_exprs = [pl.col(time_col).cast(pl.Float64).alias(time_col)] + [
            pl.col(c).cast(pl.Float64) for c in ch_cols
        ]
        df = df.select(cast_exprs).drop_nulls()

    if df.is_empty():
        raise ValueError("File contains no valid numeric data points after cleaning.")

    ts: list[float] = df[time_col].to_list()
    t0 = ts[0]
    ts = [t - t0 for t in ts]

    channels = {c: df[c].to_list() for c in ch_cols}
    return ts, channels, None


# ── Public dispatcher ─────────────────────────────────────────────────────────


def _read_signal_file(
    raw_path: str,
) -> tuple[list[float], dict[str, list], float | None]:
    """Read a CSV or Parquet file and return (timestamps_s, channels, t0_epoch_s).

    Automatically detects whether the file is in long/stacked format
    (``datetime``, ``signal_name``, ``signal_value`` columns) or the legacy
    wide format (first column = time axis, remaining = channels).

    Returns:
        timestamps_s: Elapsed-seconds list (first point = 0.0).
        channels: ``{channel_name: [float | None, ...]}`` — lists are parallel
                  to ``timestamps_s``; ``None`` entries indicate missing data
                  after time-alignment (stacked format only).
        t0_epoch_s: Unix epoch seconds of the first timestamp when the time
            column is temporal; ``None`` for purely numeric time columns.
    """
    df = _load_raw_dataframe(raw_path)
    if _is_stacked_format(df):
        logger.info("Detected long/stacked CSV format for %s", raw_path)
        return _read_stacked_signal_file(df)
    return _read_wide_signal_file(df)


def _read_with_config(
    raw_path: str,
    time_column: str,
    signal_columns: list[str],
) -> tuple[list[float], dict[str, list[float]], float | None]:
    """Read a raw file using an explicit user-supplied column mapping (EPIC-FLX).

    Bypasses all auto-detection heuristics.  The caller is responsible for
    validating that *time_column* and *signal_columns* exist in the file before
    invoking this function (validated in :meth:`SignalService.process_signal`).

    Temporal time columns (e.g. ISO datetime strings parsed by Polars) are
    handled correctly: elapsed seconds are computed from the first timestamp
    and the Unix epoch of that first timestamp is returned as ``t0_epoch_s``
    so that callers can reconstruct absolute datetime values for axis display.

    Args:
        raw_path: Absolute path to the raw uploaded file.
        time_column: Name of the column to use as the time axis.
        signal_columns: Names of the columns to treat as signal channels.

    Returns:
        timestamps_s: Elapsed-seconds list starting at 0.0.
        channels: ``{channel_name: [float, ...]}`` parallel to ``timestamps_s``.
        t0_epoch_s: Unix epoch seconds of the first timestamp when the time
            column is temporal; ``None`` for purely numeric time columns.

    Raises:
        ValueError: If any column is missing or the data cannot be cast to float.
    """
    df = _load_raw_dataframe(raw_path)

    missing = [c for c in [time_column, *signal_columns] if c not in df.columns]
    if missing:
        raise ValueError(f"Columns not found in file: {missing}")

    if df[time_column].dtype.is_temporal():
        # Temporal time column: cast only signal columns to Float64
        ch_cast = [pl.col(c).cast(pl.Float64) for c in signal_columns]
        df = (
            df.select([time_column, *signal_columns]).with_columns(ch_cast).drop_nulls()
        )

        if df.is_empty():
            raise ValueError(
                "File contains no valid numeric data points after cleaning."
            )

        timestamps_s, channels, t0_epoch_s_val = _parse_temporal_time_column(
            df, time_column, signal_columns
        )
        return timestamps_s, channels, t0_epoch_s_val
    else:
        # Numeric time column: cast everything to Float64
        all_cols = [time_column, *signal_columns]
        cast_exprs = [pl.col(c).cast(pl.Float64) for c in all_cols]
        df = df.select(cast_exprs).drop_nulls()

        if df.is_empty():
            raise ValueError(
                "File contains no valid numeric data points after cleaning."
            )

        ts: list[float] = df[time_column].to_list()
        t0 = ts[0]
        timestamps_s = [t - t0 for t in ts]
        channels: dict[str, list[float]] = {c: df[c].to_list() for c in signal_columns}
        return timestamps_s, channels, None


async def run_pipeline(
    signal_id: uuid.UUID,
    raw_file_path: str,
    session_factory,  # async_sessionmaker
    storage: IStorageAdapter,
    csv_format: str = "auto",  # "wide", "stacked", or "auto" (internal legacy path)
    time_column: str | None = None,
    signal_columns: list[str] | None = None,
    stacked_channel_filter: list[str] | None = None,
    datetime_column: str | None = None,
    unit_column: str | None = None,
) -> None:
    """Entry point called by BackgroundTasks.

    Routing logic
    -------------
    * ``csv_format="stacked"``: Use the stacked/long-format reader with an
      optional *stacked_channel_filter* to select a subset of channels.
      *datetime_column* overrides alias-based datetime detection.
    * ``csv_format="wide"`` with *time_column* and *signal_columns* provided:
      Use the explicit user-configured wide-format reader (EPIC-FLX).
    * ``csv_format="auto"`` (default, internal use only): Fall back to the
      auto-detecting reader for backward compatibility (ADR-008).  This value
      is intentionally not exposed through the public API schemas.

    When *unit_column* is provided, per-channel unit strings are extracted from
    the raw file and stored as ``__unit_<channel_name>`` constant columns in the
    processed Parquet so that ``get_macro_view`` can surface them to the client.
    """
    async with session_factory() as session:
        repo = SignalRepository(session)

        await repo.update_signal_processing(signal_id, ProcessingStatus.PROCESSING)

        try:
            channel_units: dict[str, str] = {}

            if csv_format == "stacked":
                df = _load_raw_dataframe(raw_file_path)
                timestamps, channels, t0_epoch_s = _read_stacked_signal_file(
                    df, stacked_channel_filter, datetime_column
                )
                if unit_column:
                    channel_units = _extract_channel_units(
                        df, unit_column, channels, "stacked"
                    )
            elif time_column and signal_columns:
                timestamps, channels, t0_epoch_s = _read_with_config(
                    raw_file_path, time_column, signal_columns
                )
                if unit_column:
                    raw_df = _load_raw_dataframe(raw_file_path)
                    channel_units = _extract_channel_units(
                        raw_df, unit_column, channels, "wide"
                    )
            else:
                timestamps, channels, t0_epoch_s = _read_signal_file(raw_file_path)
            channel_names = list(channels.keys())

            # Classify + segment on the primary (first) channel
            primary_values = channels[channel_names[0]]
            primary_states = classifier.classify(primary_values)
            raw_runs = segmenter.segment(timestamps, primary_values, primary_states)

            # Build processed DataFrame with per-channel value + state columns.
            # When the time column is temporal, store t0_epoch_s as a constant
            # column so that consumers can reconstruct absolute datetime labels.
            data: dict[str, list] = {"timestamp_s": timestamps}
            if t0_epoch_s is not None:
                data["t0_epoch_s"] = [t0_epoch_s] * len(timestamps)
            for ch_name, ch_vals in channels.items():
                data[ch_name] = ch_vals
                if ch_name == channel_names[0]:
                    data[f"{ch_name}_state"] = primary_states
                else:
                    data[f"{ch_name}_state"] = classifier.classify(ch_vals)

            # Store per-channel unit strings as constant columns so that
            # get_macro_view can surface them without re-reading the raw file.
            for ch_name, unit_str in channel_units.items():
                data[f"__unit_{ch_name}"] = [unit_str] * len(timestamps)

            processed_df = pl.DataFrame(data)
            buf = io.BytesIO()
            processed_df.write_parquet(buf)
            processed_relative = f"signals/{signal_id}/processed.parquet"
            processed_abs = await storage.save(processed_relative, buf.getvalue())

            await repo.create_runs(signal_id, raw_runs)

            await repo.update_signal_processing(
                signal_id,
                status=ProcessingStatus.COMPLETED,
                total_points=len(timestamps),
                active_run_count=len(raw_runs),
                processed_file_path=processed_abs,
                channel_names=channel_names,
            )

        except Exception as exc:
            logger.exception("Pipeline failed for signal %s", signal_id)
            async with session_factory() as err_session:
                err_repo = SignalRepository(err_session)
                await err_repo.update_signal_processing(
                    signal_id,
                    ProcessingStatus.FAILED,
                    error_message=str(exc),
                )
