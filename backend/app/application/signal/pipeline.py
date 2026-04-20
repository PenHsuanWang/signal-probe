"""PipelineOrchestrator: reads raw file → classify → segment → persist.

Runs as a FastAPI BackgroundTask (ADR-002).
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


def _read_signal_file(raw_path: str) -> tuple[list[float], dict[str, list[float]]]:
    """Read a CSV or Parquet file and return (timestamps_s, channels).

    Returns:
        timestamps_s: elapsed-seconds list (first point = 0.0)
        channels: OrderedDict {channel_name: [float, ...]}
    """
    ext = os.path.splitext(raw_path)[1].lower()

    if ext in (".parquet", ".pq"):
        df = pl.read_parquet(raw_path)
    else:
        df = pl.read_csv(raw_path, infer_schema_length=500, try_parse_dates=True)

    # Identify all usable columns
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


async def run_pipeline(
    signal_id: uuid.UUID,
    raw_file_path: str,
    session_factory,  # async_sessionmaker
    storage: IStorageAdapter,
) -> None:
    """Entry point called by BackgroundTasks."""
    async with session_factory() as session:
        repo = SignalRepository(session)

        await repo.update_signal_processing(signal_id, ProcessingStatus.PROCESSING)

        try:
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
