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
from app.domain.signal.repository import SignalRepository
from app.infrastructure.storage.interface import IStorageAdapter

logger = logging.getLogger(__name__)

# ── Format detection ──────────────────────────────────────────────────────────

_STACKED_REQUIRED_COLS = {"datetime", "signal_name", "signal_value"}


def _is_stacked_format(df: pl.DataFrame) -> bool:
    """Return True when *df* has the canonical long/stacked-format columns.

    Detection is case-insensitive; extra columns in the file are ignored.
    """
    lower_cols = {c.lower() for c in df.columns}
    return _STACKED_REQUIRED_COLS.issubset(lower_cols)


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
) -> tuple[list[float], dict[str, list[float | None]]]:
    """Parse a long/stacked CSV into (timestamps_s, channels).

    Steps
    -----
    1. Normalise column names to lower-case.
    2. Cast ``signal_value`` to Float64; drop rows with null in key columns.
    3. Pivot on ``signal_name`` → wide DataFrame (outer-join semantics;
       missing positions become ``null``).
    4. Sort by ``datetime`` and compute elapsed seconds from the first timestamp.
    5. Return ``(timestamps_s, {signal_name: [float | None, ...]})`` where
       ``None`` marks timestamps absent for a given channel.

    Args:
        df: Raw DataFrame loaded from the stacked CSV.

    Returns:
        timestamps_s: Elapsed-seconds list starting at 0.0.
        channels: Ordered dict ``{signal_name: [float | None, ...]}``,
                  all lists parallel to ``timestamps_s``.

    Raises:
        ValueError: If the DataFrame is empty after cleaning or has no channels.
    """
    # Normalise column names so detection is case-insensitive
    df = df.rename({c: c.lower() for c in df.columns})

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

    # Compute elapsed seconds (Float64) from the first timestamp.
    # Polars stores Datetime as int64 microseconds; dividing by 1e6 gives seconds.
    t0 = aligned["datetime"].min()
    elapsed = (aligned["datetime"] - t0).dt.total_microseconds().cast(pl.Float64)
    timestamps_s: list[float] = (elapsed / 1_000_000.0).to_list()

    channels: dict[str, list[float | None]] = {
        col: aligned[col].to_list() for col in ch_cols
    }
    return timestamps_s, channels


# ── Wide-format reader (existing logic, extracted) ────────────────────────────


def _read_wide_signal_file(
    df: pl.DataFrame,
) -> tuple[list[float], dict[str, list[float]]]:
    """Parse a wide-format CSV/Parquet into (timestamps_s, channels).

    The first numeric/temporal column is treated as the time axis; all
    remaining numeric columns are value channels.
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
        cast_exprs = [pl.col(time_col).cast(pl.Float64).alias(time_col)] + [
            pl.col(c).cast(pl.Float64) for c in ch_cols
        ]
        df = df.select(cast_exprs).drop_nulls()

    if df.is_empty():
        raise ValueError("File contains no valid numeric data points after cleaning.")

    ts: list[float] = df[time_col].to_list()
    t0 = ts[0]
    ts = [t - t0 for t in ts]

    channels: dict[str, list[float]] = {c: df[c].to_list() for c in ch_cols}
    return ts, channels


# ── Public dispatcher ─────────────────────────────────────────────────────────


def _read_signal_file(raw_path: str) -> tuple[list[float], dict[str, list]]:
    """Read a CSV or Parquet file and return (timestamps_s, channels).

    Automatically detects whether the file is in long/stacked format
    (``datetime``, ``signal_name``, ``signal_value`` columns) or the legacy
    wide format (first column = time axis, remaining = channels).

    Returns:
        timestamps_s: Elapsed-seconds list (first point = 0.0).
        channels: ``{channel_name: [float | None, ...]}`` — lists are parallel
                  to ``timestamps_s``; ``None`` entries indicate missing data
                  after time-alignment (stacked format only).
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
) -> tuple[list[float], dict[str, list[float]]]:
    """Read a raw file using an explicit user-supplied column mapping (EPIC-FLX).

    Bypasses all auto-detection heuristics.  The caller is responsible for
    validating that *time_column* and *signal_columns* exist in the file before
    invoking this function (validated in :meth:`SignalService.process_signal`).

    Args:
        raw_path: Absolute path to the raw uploaded file.
        time_column: Name of the column to use as the time axis.
        signal_columns: Names of the columns to treat as signal channels.

    Returns:
        timestamps_s: Elapsed-seconds list starting at 0.0.
        channels: ``{channel_name: [float, ...]}`` parallel to ``timestamps_s``.

    Raises:
        ValueError: If any column is missing or the data cannot be cast to float.
    """
    df = _load_raw_dataframe(raw_path)

    missing = [c for c in [time_column, *signal_columns] if c not in df.columns]
    if missing:
        raise ValueError(f"Columns not found in file: {missing}")

    all_cols = [time_column, *signal_columns]
    cast_exprs = [pl.col(c).cast(pl.Float64) for c in all_cols]
    df = df.select(cast_exprs).drop_nulls()

    if df.is_empty():
        raise ValueError("File contains no valid numeric data points after cleaning.")

    ts: list[float] = df[time_column].to_list()
    t0 = ts[0]
    timestamps_s = [t - t0 for t in ts]

    channels: dict[str, list[float]] = {c: df[c].to_list() for c in signal_columns}
    return timestamps_s, channels


async def run_pipeline(
    signal_id: uuid.UUID,
    raw_file_path: str,
    session_factory,  # async_sessionmaker
    storage: IStorageAdapter,
    time_column: str | None = None,
    signal_columns: list[str] | None = None,
) -> None:
    """Entry point called by BackgroundTasks.

    When *time_column* and *signal_columns* are provided (EPIC-FLX user-configured
    flow) the explicit mapping is used.  When both are ``None`` the legacy
    auto-detection path is used (backward compatibility, ADR-008).
    """
    async with session_factory() as session:
        repo = SignalRepository(session)

        await repo.update_signal_processing(signal_id, ProcessingStatus.PROCESSING)

        try:
            if time_column and signal_columns:
                timestamps, channels = _read_with_config(
                    raw_file_path, time_column, signal_columns
                )
            else:
                timestamps, channels = _read_signal_file(raw_file_path)
            channel_names = list(channels.keys())

            # Classify + segment on the primary (first) channel
            primary_values = channels[channel_names[0]]
            primary_states = classifier.classify(primary_values)
            raw_runs = segmenter.segment(timestamps, primary_values, primary_states)

            # Build processed DataFrame with per-channel value + state columns
            data: dict[str, list] = {"timestamp_s": timestamps}
            for ch_name, ch_vals in channels.items():
                data[ch_name] = ch_vals
                if ch_name == channel_names[0]:
                    data[f"{ch_name}_state"] = primary_states
                else:
                    data[f"{ch_name}_state"] = classifier.classify(ch_vals)

            processed_df = pl.DataFrame(data)
            buf = io.BytesIO()
            processed_df.write_parquet(buf)
            processed_relative = f"signals/{signal_id}/processed.parquet"
            processed_abs = await storage.save(processed_relative, buf.getvalue())

            await repo.create_runs(signal_id, raw_runs)

            total_ooc = sum(r.ooc_count for r in raw_runs)
            await repo.update_signal_processing(
                signal_id,
                status=ProcessingStatus.COMPLETED,
                total_points=len(timestamps),
                active_run_count=len(raw_runs),
                ooc_count=total_ooc,
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
