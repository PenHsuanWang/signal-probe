"""SignalService: use-case orchestration for signal upload, listing, and views."""

import asyncio
import json
import os
import uuid

import polars as pl
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.signal.column_inspector import ColumnInspector
from app.application.signal.pipeline import _load_raw_dataframe, run_pipeline
from app.core.exceptions import NotFoundException
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.models import RunSegment, SignalMetadata
from app.domain.signal.repository import SignalRepository
from app.domain.signal.schemas import (
    ChannelChunkData,
    ChannelMacroData,
    MacroViewResponse,
    ProcessSignalRequest,
    RawColumnsResponse,
    RunBound,
    RunChunkResponse,
    SignalMetadataResponse,
)
from app.infrastructure.storage.interface import IStorageAdapter

# Fire-and-forget task registry.  asyncio discards Task objects that have no
# live references, which cancels them before they finish.  Storing each task
# here keeps a strong reference alive until the task completes or raises,
# at which point the done-callback removes it.  Scoped to a single process;
# does not survive worker restarts.
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
        session_factory: async_sessionmaker,
    ) -> SignalMetadata:
        """Save the raw file and create a metadata record in AWAITING_CONFIG state.

        The processing pipeline is NOT triggered here.  The user must call
        :meth:`process_signal` after selecting column mappings (EPIC-FLX).
        """
        ext = os.path.splitext(filename)[1].lower() or ".csv"
        signal = await self.repo.create_signal(
            owner_id=owner_id,
            original_filename=filename,
            file_path="",
        )

        relative_path = f"signals/{signal.id}/raw{ext}"
        abs_path = await self.storage.save(relative_path, file_bytes)

        await self.session.execute(
            sa_update(SignalMetadata)
            .where(SignalMetadata.id == signal.id)
            .values(file_path=abs_path)
        )
        await self.session.commit()
        await self.session.refresh(signal)

        return signal

    # ── Column inspection ────────────────────────────────────────────────────

    async def get_raw_columns(self, signal_id: uuid.UUID) -> RawColumnsResponse:
        """Return column descriptors for the raw uploaded file.

        Also detects whether the file is in wide or stacked (long) format.
        For stacked format, the unique signal names from the ``signal_name``
        column are included in the response so the frontend can render a
        channel-picker instead of the generic column selector.

        Only available when the signal is in AWAITING_CONFIG state.

        Raises:
            NotFoundException: If signal not found.
            LookupError: If signal is not in AWAITING_CONFIG state.
            ValueError: If file is unreadable.
        """
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise NotFoundException("Signal not found")
        if signal.status != ProcessingStatus.AWAITING_CONFIG:
            raise LookupError(
                f"Column preview is only available for signals awaiting configuration "
                f"(current status: {signal.status})"
            )
        if not signal.file_path:
            raise ValueError("Raw file path is not set")

        inspector = ColumnInspector()
        columns = inspector.inspect_columns(signal.file_path)
        csv_format, stacked_signal_names = inspector.detect_csv_format(signal.file_path)
        return RawColumnsResponse(
            signal_id=signal_id,
            columns=columns,
            csv_format=csv_format,
            stacked_signal_names=stacked_signal_names,
        )

    # ── Process (trigger pipeline with user config) ──────────────────────────

    async def process_signal(
        self,
        signal_id: uuid.UUID,
        request: ProcessSignalRequest,
        session_factory: async_sessionmaker,
    ) -> SignalMetadata:
        """Validate column config, persist it, and queue the pipeline.

        Supports both wide format (explicit ``time_column`` + ``signal_columns``)
        and stacked/long format (``csv_format="stacked"`` with an optional
        ``stacked_channel_filter``).

        Raises:
            NotFoundException: Signal not found.
            LookupError: Signal not in AWAITING_CONFIG state.
            KeyError: Submitted column name not found in the file.
            ValueError: File unreadable or invalid configuration.
        """
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise NotFoundException("Signal not found")
        if signal.status != ProcessingStatus.AWAITING_CONFIG:
            raise LookupError(
                f"Signal is not awaiting configuration (status: {signal.status})"
            )

        if request.csv_format == "wide":
            # Server-side column validation — read only the header (1 row).
            df_head = _load_raw_dataframe(signal.file_path).head(1)
            file_cols = set(df_head.columns)

            if request.time_column not in file_cols:
                raise KeyError(f"time_column '{request.time_column}' not found in file")
            bad_sigs = [c for c in request.signal_columns if c not in file_cols]
            if bad_sigs:
                raise KeyError(f"signal_columns not found in file: {bad_sigs}")
            if request.time_column in request.signal_columns:
                raise ValueError("time_column cannot also appear in signal_columns")
            if request.unit_column and request.unit_column not in file_cols:
                raise KeyError(f"unit_column '{request.unit_column}' not found in file")

            config_time_col: str | None = request.time_column
            config_sig_cols: list[str] = request.signal_columns
        else:
            # Stacked format — validate datetime_column and unit_column against
            # file columns, then validate the optional channel filter.
            if request.datetime_column or request.unit_column:
                df_head = _load_raw_dataframe(signal.file_path).head(1)
                file_cols = set(df_head.columns)
                if request.datetime_column and request.datetime_column not in file_cols:
                    raise KeyError(
                        f"datetime_column '{request.datetime_column}' not found in file"
                    )
                if request.unit_column and request.unit_column not in file_cols:
                    raise KeyError(
                        f"unit_column '{request.unit_column}' not found in file"
                    )
            if request.stacked_channel_filter:
                _, available_names = ColumnInspector().detect_csv_format(
                    signal.file_path
                )
                available_set = set(available_names)
                bad_channels = [
                    c for c in request.stacked_channel_filter if c not in available_set
                ]
                if bad_channels:
                    raise KeyError(
                        f"stacked channel names not found in file: {bad_channels}"
                    )
            # Store None for time_column (implicit in stacked format) and the
            # optional channel filter in signal_columns.
            config_time_col = None
            config_sig_cols = request.stacked_channel_filter or []

        await self.repo.save_column_config(signal_id, config_time_col, config_sig_cols)
        await self.session.refresh(signal)

        task = asyncio.create_task(
            run_pipeline(
                signal.id,
                signal.file_path,
                session_factory,
                self.storage,
                csv_format=request.csv_format,
                time_column=request.time_column
                if request.csv_format == "wide"
                else None,
                signal_columns=request.signal_columns
                if request.csv_format == "wide"
                else None,
                stacked_channel_filter=request.stacked_channel_filter,
                datetime_column=request.datetime_column,
                unit_column=request.unit_column,
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

        return signal

    # ── Reconfigure ──────────────────────────────────────────────────────────

    async def reconfigure_signal(self, signal_id: uuid.UUID) -> SignalMetadata:
        """Reset a COMPLETED or FAILED signal back to AWAITING_CONFIG.

        Deletes all run_segments and the processed Parquet file.
        The raw uploaded file is preserved.

        Raises:
            NotFoundException: Signal not found.
            LookupError: Signal is currently PROCESSING (cannot interrupt).
        """
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise NotFoundException("Signal not found")
        if signal.status == ProcessingStatus.PROCESSING:
            raise LookupError("Cannot reconfigure a signal while it is being processed")

        # Delete the processed Parquet from storage (best-effort; ignore missing).
        if signal.processed_file_path:
            try:
                await self.storage.delete(signal.processed_file_path)
            except Exception:
                pass

        await self.repo.reset_for_reconfiguration(signal_id)
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
            raise NotFoundException("Signal not found")
        if signal.status != ProcessingStatus.COMPLETED:
            raise ValueError(f"Signal is not ready (status={signal.status})")
        if not signal.processed_file_path:
            raise ValueError("Processed file not available")

        channel_names = self._decode_channel_names(signal.channel_names)
        df = pl.read_parquet(signal.processed_file_path)

        x: list[float] = df["timestamp_s"].to_list()

        # Read the epoch offset if stored (present for temporal time columns).
        t0_epoch_s: float | None = (
            float(df["t0_epoch_s"][0]) if "t0_epoch_s" in df.columns else None
        )

        # Return all original data points for every channel (no downsampling)
        channel_data: list[ChannelMacroData] = []
        for ch_name in channel_names:
            ch_y: list[float] = df[ch_name].to_list()
            ch_states: list[str] = df[f"{ch_name}_state"].to_list()
            channel_data.append(
                ChannelMacroData(channel_name=ch_name, y=ch_y, states=ch_states)
            )

        # Collect per-channel unit strings stored as __unit_<channel_name> columns.
        channel_units: dict[str, str] = {}
        for ch_name in channel_names:
            unit_key = f"__unit_{ch_name}"
            if unit_key in df.columns:
                raw_unit = df[unit_key][0]
                if raw_unit is not None:
                    channel_units[ch_name] = str(raw_unit)

        run_bounds = [
            RunBound(
                run_id=r.id,
                run_index=r.run_index,
                start_x=r.start_x,
                end_x=r.end_x,
            )
            for r in sorted(signal.runs, key=lambda r: r.run_index)
        ]

        return MacroViewResponse(
            signal_id=signal.id,
            x=x,
            channels=channel_data,
            runs=run_bounds,
            t0_epoch_s=t0_epoch_s,
            channel_units=channel_units,
        )

    # ── Run chunks ──────────────────────────────────────────────────────────

    async def get_run_chunks(
        self, signal_id: uuid.UUID, run_ids: list[uuid.UUID]
    ) -> list[RunChunkResponse]:
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise NotFoundException("Signal not found")
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
