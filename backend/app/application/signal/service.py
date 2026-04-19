"""SignalService: use-case orchestration for signal upload, listing, and views."""

import os
import uuid

import polars as pl
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.signal.algorithms import lttb
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.models import RunSegment, SignalMetadata
from app.domain.signal.repository import SignalRepository
from app.domain.signal.schemas import (
    MacroViewResponse,
    RunBound,
    RunChunkResponse,
    SignalMetadataResponse,
)
from app.infrastructure.storage.local import LocalStorageAdapter

_storage = LocalStorageAdapter()


class SignalService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = SignalRepository(session)

    # ── Upload ──────────────────────────────────────────────────────────────

    async def upload_signal(
        self,
        owner_id: uuid.UUID,
        filename: str,
        file_bytes: bytes,
        session_factory: async_sessionmaker,
    ) -> SignalMetadata:
        from app.application.signal.pipeline import run_pipeline

        ext = os.path.splitext(filename)[1].lower() or ".csv"
        signal = await self.repo.create_signal(
            owner_id=owner_id,
            original_filename=filename,
            file_path="",  # will be filled after save
        )

        relative_path = f"signals/{signal.id}/raw{ext}"
        abs_path = await _storage.save(relative_path, file_bytes)

        # Patch file_path on the record
        from sqlalchemy import update as sa_update

        from app.domain.signal.models import SignalMetadata as SM

        await self.session.execute(
            sa_update(SM).where(SM.id == signal.id).values(file_path=abs_path)
        )
        await self.session.commit()
        await self.session.refresh(signal)

        # Trigger background processing
        from fastapi import BackgroundTasks

        bt = BackgroundTasks()
        bt.add_task(run_pipeline, signal.id, abs_path, session_factory)
        # Run directly (BackgroundTasks are executed by FastAPI; we call the
        # coroutine scheduler via asyncio for the background task approach)
        import asyncio

        asyncio.get_event_loop().create_task(
            run_pipeline(signal.id, abs_path, session_factory)
        )

        return signal

    # ── List ────────────────────────────────────────────────────────────────

    async def list_signals(self, owner_id: uuid.UUID) -> list[SignalMetadataResponse]:
        signals = await self.repo.list_signals(owner_id)
        return [SignalMetadataResponse.model_validate(s) for s in signals]

    # ── Get single ──────────────────────────────────────────────────────────

    async def get_signal(self, signal_id: uuid.UUID) -> SignalMetadata | None:
        return await self.repo.get_signal(signal_id)

    # ── Macro view ──────────────────────────────────────────────────────────

    async def get_macro_view(self, signal_id: uuid.UUID) -> MacroViewResponse:
        signal = await self.repo.get_signal(signal_id)
        if signal is None:
            raise ValueError("Signal not found")
        if signal.status != ProcessingStatus.COMPLETED:
            raise ValueError(f"Signal is not ready (status={signal.status})")
        if not signal.processed_file_path:
            raise ValueError("Processed file not available")

        df = pl.read_parquet(signal.processed_file_path)
        x: list[float] = df["timestamp_s"].to_list()
        y: list[float] = df["value"].to_list()
        states: list[str] = df["state"].to_list()

        x_down, y_down, states_down = lttb.downsample_with_states(x, y, states)

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
            y=y_down,
            states=states_down,
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
            cy: list[float] = chunk["value"].to_list()
            cs: list[str] = chunk["state"].to_list()

            # Normalise to relative time within the run
            if cx:
                t0 = cx[0]
                cx = [t - t0 for t in cx]

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
                    y=cy,
                    states=cs,
                )
            )

        return results
