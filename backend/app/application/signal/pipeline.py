"""PipelineOrchestrator: reads raw file → classify → segment → persist.

Runs as a FastAPI BackgroundTask (ADR-002).
"""

import logging
import os
import uuid

import polars as pl

from app.domain.signal.algorithms import classifier, segmenter
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.repository import SignalRepository
from app.infrastructure.storage.local import LocalStorageAdapter

logger = logging.getLogger(__name__)

_storage = LocalStorageAdapter()


def _read_signal_file(raw_path: str) -> tuple[list[float], list[float]]:
    """Read a CSV or Parquet file and return (timestamps_s, values).

    Timestamps are normalised to elapsed seconds (first point = 0.0).
    The first numeric column is treated as time/index; the second as value.
    """
    ext = os.path.splitext(raw_path)[1].lower()

    if ext in (".parquet", ".pq"):
        df = pl.read_parquet(raw_path)
    else:
        # CSV: infer separator, first row as header
        df = pl.read_csv(raw_path, infer_schema_length=500, try_parse_dates=True)

    # Select the first two usable (numeric or temporal) columns
    numeric_cols = [
        c for c, t in zip(df.columns, df.dtypes) if t.is_numeric() or t.is_temporal()
    ]
    if len(numeric_cols) < 2:
        # Fall back: use row index as time and first numeric as value
        value_col = numeric_cols[0] if numeric_cols else df.columns[0]
        df = df.with_row_index("__ts__").select(
            [
                pl.col("__ts__").cast(pl.Float64).alias("ts"),
                pl.col(value_col).cast(pl.Float64).alias("val"),
            ]
        )
    else:
        df = df.select(
            [
                pl.col(numeric_cols[0]).cast(pl.Float64).alias("ts"),
                pl.col(numeric_cols[1]).cast(pl.Float64).alias("val"),
            ]
        )

    df = df.drop_nulls()
    ts: list[float] = df["ts"].to_list()
    vals: list[float] = df["val"].to_list()

    # Normalise timestamps to elapsed seconds
    t0 = ts[0]
    ts = [t - t0 for t in ts]

    return ts, vals


async def run_pipeline(
    signal_id: uuid.UUID,
    raw_file_path: str,
    session_factory,  # async_sessionmaker
) -> None:
    """Entry point called by BackgroundTasks."""
    async with session_factory() as session:
        repo = SignalRepository(session)

        # Mark as PROCESSING
        await repo.update_signal_processing(
            signal_id, ProcessingStatus.PROCESSING
        )

        try:
            timestamps, values = _read_signal_file(raw_file_path)

            # 1. Classify states
            states = classifier.classify(values)

            # 2. Segment runs
            raw_runs = segmenter.segment(timestamps, values, states)

            # 3. Persist processed signal as parquet
            processed_df = pl.DataFrame(
                {"timestamp_s": timestamps, "value": values, "state": states}
            )
            processed_relative = f"signals/{signal_id}/processed.parquet"
            processed_abs = await _storage.save(
                processed_relative, processed_df.write_parquet(None)  # type: ignore[arg-type]
            )

            # 4. Persist run segments to DB
            await repo.create_runs(signal_id, raw_runs)

            total_ooc = sum(r.ooc_count for r in raw_runs)
            await repo.update_signal_processing(
                signal_id,
                status=ProcessingStatus.COMPLETED,
                total_points=len(timestamps),
                active_run_count=len(raw_runs),
                ooc_count=total_ooc,
                processed_file_path=processed_abs,
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
