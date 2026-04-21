"""SignalService: use-case orchestration for signal upload, listing, and views."""

import asyncio
import json
import os
import uuid

import polars as pl
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.signal.algorithms import lttb
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.models import RunSegment, SignalMetadata
from app.domain.signal.repository import SignalRepository
from app.domain.signal.schemas import (
    ChannelChunkData,
    ChannelMacroData,
    MacroViewResponse,
    RawColumnsResponse,
    RunBound,
    RunChunkResponse,
    SignalMetadataResponse,
)
from app.infrastructure.storage.interface import IStorageAdapter

_background_tasks: set[asyncio.Task] = set()


class SignalService:
    def __init__(self, session: AsyncSession, storage: IStorageAdapter) -> None:
        self.session = session
        self.repo = SignalRepository(session)
        self.storage = storage

    # ── Upload ──────────────────────────────────────────────────────────────

    async def upload_signal(
        self,
        owner_id: uuid.UUID,
        filename: str,
        file_bytes: bytes,
    ) -> SignalMetadata:
        """Persist the raw file and return metadata in AWAITING_CONFIG state.

        The processing pipeline is *not* started here — the caller must
        invoke :meth:`configure_and_process` once the user has selected
        the time column and signal columns.
        """
        ext = os.path.splitext(filename)[1].lower() or ".csv"
        signal = await self.repo.create_signal(
            owner_id=owner_id,
            original_filename=filename,
            file_path="",
        )

        relative_path = f"signals/{signal.id}/raw{ext}"
        abs_path = await self.storage.save(relative_path, file_bytes)

        from sqlalchemy import update as sa_update

        from app.domain.signal.models import SignalMetadata as SM

        await self.session.execute(
            sa_update(SM)
            .where(SM.id == signal.id)
            .values(file_path=abs_path, status=ProcessingStatus.AWAITING_CONFIG)
        )
        await self.session.commit()
        await self.session.refresh(signal)

        return signal

    # ── Raw column preview ───────────────────────────────────────────────────

    async def get_raw_columns(self, signal_id: uuid.UUID) -> RawColumnsResponse:
        """Return column headers from the raw uploaded file.

        For wide-format files: all columns are returned.  The first
        numeric/temporal column is suggested as the time axis; the rest
        as signal columns.

        For stacked-format files (datetime/signal_name/signal_value schema):
        the unique values in ``signal_name`` are returned as available channels
        with ``datetime`` suggested as the time column.
        """
        from app.application.signal.pipeline import (
            _is_stacked_format,
            _load_raw_dataframe,
        )

        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise ValueError("Signal not found")
        if not signal.file_path:
            raise ValueError("Raw file not available")

        df = _load_raw_dataframe(signal.file_path)

        if _is_stacked_format(df):
            df_norm = df.rename({c: c.lower() for c in df.columns})
            signal_names = df_norm["signal_name"].drop_nulls().unique().sort().to_list()
            return RawColumnsResponse(
                columns=signal_names,
                suggested_time_column="datetime",
                suggested_signal_columns=signal_names,
            )

        all_cols = df.columns
        numeric_cols = [
            c
            for c, t in zip(df.columns, df.dtypes)
            if t.is_numeric() or t.is_temporal()
        ]
        suggested_time = (
            numeric_cols[0] if numeric_cols else (all_cols[0] if all_cols else None)
        )
        suggested_signals = numeric_cols[1:] if len(numeric_cols) > 1 else numeric_cols
        return RawColumnsResponse(
            columns=all_cols,
            suggested_time_column=suggested_time,
            suggested_signal_columns=suggested_signals,
        )

    # ── Configure and start pipeline ─────────────────────────────────────────

    async def configure_and_process(
        self,
        signal_id: uuid.UUID,
        time_column: str,
        signal_columns: list[str],
        session_factory: async_sessionmaker,
    ) -> SignalMetadata:
        """Validate column selection and kick off the processing pipeline."""
        from app.application.signal.pipeline import run_pipeline

        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise ValueError("Signal not found")
        if signal.status not in (
            ProcessingStatus.AWAITING_CONFIG,
            ProcessingStatus.FAILED,
        ):
            raise ValueError(
                f"Signal cannot be (re-)configured in status '{signal.status}'"
            )
        if not signal.file_path:
            raise ValueError("Raw file not available")

        task = asyncio.create_task(
            run_pipeline(
                signal.id,
                signal.file_path,
                session_factory,
                self.storage,
                time_column=time_column,
                signal_columns=signal_columns,
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

        await self.session.refresh(signal)
        return signal

    # ── List ────────────────────────────────────────────────────────────────

    async def list_signals(self, owner_id: uuid.UUID) -> list[SignalMetadataResponse]:
        signals = await self.repo.list_signals(owner_id)
        return [SignalMetadataResponse.model_validate(s) for s in signals]

    # ── Get single ──────────────────────────────────────────────────────────

    async def get_signal(self, signal_id: uuid.UUID) -> SignalMetadata | None:
        return await self.repo.get_signal(signal_id)

    # ── Rename ──────────────────────────────────────────────────────────────

    async def rename_signal(
        self, signal_id: uuid.UUID, new_filename: str
    ) -> SignalMetadataResponse | None:
        ok = await self.repo.rename_signal(signal_id, new_filename)
        if not ok:
            return None
        signal = await self.repo.get_signal(signal_id)
        return SignalMetadataResponse.model_validate(signal) if signal else None

    # ── Delete ──────────────────────────────────────────────────────────────

    async def delete_signal(self, signal_id: uuid.UUID) -> bool:
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            return False

        file_paths = [p for p in (signal.file_path, signal.processed_file_path) if p]
        deleted = await self.repo.delete_signal(signal_id)
        if deleted:
            for path in file_paths:
                await self.storage.delete(path)
        return deleted

    # ── Macro view ──────────────────────────────────────────────────────────

    async def get_macro_view(self, signal_id: uuid.UUID) -> MacroViewResponse:
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise ValueError("Signal not found")
        if signal.status != ProcessingStatus.COMPLETED:
            raise ValueError(f"Signal is not ready (status={signal.status})")
        if not signal.processed_file_path:
            raise ValueError("Processed file not available")

        channel_names = self._decode_channel_names(signal.channel_names)
        df = pl.read_parquet(signal.processed_file_path)

        x: list[float] = df["timestamp_s"].to_list()
        primary_ch = channel_names[0]
        primary_y: list[float] = df[primary_ch].to_list()
        primary_states: list[str] = df[f"{primary_ch}_state"].to_list()

        # Downsample x on primary channel; get shared indices
        x_down, y_down, states_down = lttb.downsample_with_states(
            x, primary_y, primary_states
        )

        # Build per-channel data (reuse downsampled x indices for all channels)
        sample_indices = _find_sample_indices(x, x_down)
        channel_data: list[ChannelMacroData] = []
        for ch_name in channel_names:
            ch_y: list[float] = df[ch_name].to_list()
            ch_states: list[str] = df[f"{ch_name}_state"].to_list()
            sampled_y = [ch_y[i] for i in sample_indices]
            sampled_s = [ch_states[i] for i in sample_indices]
            channel_data.append(
                ChannelMacroData(channel_name=ch_name, y=sampled_y, states=sampled_s)
            )

        run_bounds = [
            RunBound(
                run_id=r.id,
                run_index=r.run_index,
                start_x=r.start_x,
                end_x=r.end_x,
                ooc_count=r.ooc_count,
            )
            for r in sorted(signal.runs, key=lambda r: r.run_index)
        ]

        return MacroViewResponse(
            signal_id=signal.id,
            x=x_down,
            channels=channel_data,
            runs=run_bounds,
        )

    # ── Run chunks ──────────────────────────────────────────────────────────

    async def get_run_chunks(
        self, signal_id: uuid.UUID, run_ids: list[uuid.UUID]
    ) -> list[RunChunkResponse]:
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise ValueError("Signal not found")
        if signal.status != ProcessingStatus.COMPLETED:
            raise ValueError("Signal is not ready")
        if not signal.processed_file_path:
            raise ValueError("Processed file not available")

        channel_names = self._decode_channel_names(signal.channel_names)
        segments: list[RunSegment] = await self.repo.get_runs_by_ids(signal_id, run_ids)
        if not segments:
            return []

        df = pl.read_parquet(signal.processed_file_path)
        results: list[RunChunkResponse] = []

        for seg in segments:
            chunk = df.filter(
                (pl.col("timestamp_s") >= seg.start_x)
                & (pl.col("timestamp_s") <= seg.end_x)
            )
            cx: list[float] = chunk["timestamp_s"].to_list()
            if cx:
                t0 = cx[0]
                cx = [t - t0 for t in cx]

            channel_chunks: list[ChannelChunkData] = []
            for ch_name in channel_names:
                cy: list[float] = chunk[ch_name].to_list()
                cs: list[str] = chunk[f"{ch_name}_state"].to_list()
                channel_chunks.append(
                    ChannelChunkData(channel_name=ch_name, y=cy, states=cs)
                )

            results.append(
                RunChunkResponse(
                    run_id=seg.id,
                    run_index=seg.run_index,
                    duration_seconds=seg.duration_seconds,
                    value_max=seg.value_max,
                    value_min=seg.value_min,
                    value_mean=seg.value_mean,
                    value_variance=seg.value_variance,
                    ooc_count=seg.ooc_count,
                    x=cx,
                    channels=channel_chunks,
                )
            )

        return results

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _decode_channel_names(raw: str | None) -> list[str]:
        if not raw:
            return ["value"]
        try:
            names = json.loads(raw)
            return names if isinstance(names, list) and names else ["value"]
        except Exception:
            return ["value"]


def _find_sample_indices(original_x: list[float], sampled_x: list[float]) -> list[int]:
    """Map sampled x values back to their indices in the original array.

    Uses a two-pointer approach (both lists are sorted ascending).
    """
    indices: list[int] = []
    j = 0
    for sx in sampled_x:
        while j < len(original_x) and original_x[j] < sx:
            j += 1
        indices.append(j)
        j += 1
    return indices
