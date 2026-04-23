import json
import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.signal.algorithms.segmenter import RawRun
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.models import RunSegment, SignalMetadata


class SignalRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── SignalMetadata CRUD ─────────────────────────────────────────────────

    async def create_signal(
        self,
        owner_id: uuid.UUID,
        original_filename: str,
        file_path: str,
    ) -> SignalMetadata:
        signal = SignalMetadata(
            owner_id=owner_id,
            original_filename=original_filename,
            file_path=file_path,
            status=ProcessingStatus.AWAITING_CONFIG,
        )
        self.session.add(signal)
        await self.session.commit()
        await self.session.refresh(signal)
        return signal

    async def get_signal(self, signal_id: uuid.UUID) -> SignalMetadata | None:
        result = await self.session.execute(
            select(SignalMetadata)
            .where(SignalMetadata.id == signal_id)
            .options(selectinload(SignalMetadata.runs))
        )
        return result.scalars().first()

    async def list_signals(self, owner_id: uuid.UUID) -> list[SignalMetadata]:
        result = await self.session.execute(
            select(SignalMetadata)
            .where(SignalMetadata.owner_id == owner_id)
            .order_by(SignalMetadata.created_at.desc())
        )
        return list(result.scalars().all())

    async def rename_signal(self, signal_id: uuid.UUID, new_filename: str) -> bool:
        result = await self.session.execute(
            update(SignalMetadata)
            .where(SignalMetadata.id == signal_id)
            .values(original_filename=new_filename, updated_at=func.now())
        )
        await self.session.commit()
        return result.rowcount > 0

    async def delete_signal(self, signal_id: uuid.UUID) -> bool:
        result = await self.session.execute(
            delete(SignalMetadata).where(SignalMetadata.id == signal_id)
        )
        await self.session.commit()
        return result.rowcount > 0

    async def update_signal_processing(
        self,
        signal_id: uuid.UUID,
        status: ProcessingStatus,
        total_points: int | None = None,
        active_run_count: int | None = None,
        processed_file_path: str | None = None,
        error_message: str | None = None,
        channel_names: list[str] | None = None,
    ) -> None:
        values: dict = {"status": status.value, "updated_at": func.now()}
        if total_points is not None:
            values["total_points"] = total_points
        if active_run_count is not None:
            values["active_run_count"] = active_run_count
        if processed_file_path is not None:
            values["processed_file_path"] = processed_file_path
        if error_message is not None:
            values["error_message"] = error_message
        if channel_names is not None:
            values["channel_names"] = json.dumps(channel_names)
        await self.session.execute(
            update(SignalMetadata)
            .where(SignalMetadata.id == signal_id)
            .values(**values)
        )
        await self.session.commit()

    async def save_column_config(
        self,
        signal_id: uuid.UUID,
        time_column: str | None,
        signal_columns: list[str],
    ) -> None:
        """Persist user-selected column mapping and advance status to PENDING.

        For wide format: *time_column* is the name of the time axis column and
        *signal_columns* are the value channel column names.

        For stacked format: *time_column* is ``None`` (the time axis is the
        implicit ``datetime`` column) and *signal_columns* holds the optional
        channel filter (empty list = include all channels).
        """
        await self.session.execute(
            update(SignalMetadata)
            .where(SignalMetadata.id == signal_id)
            .values(
                time_column=time_column,
                signal_columns=json.dumps(signal_columns),
                status=ProcessingStatus.PENDING.value,
                error_message=None,
                updated_at=func.now(),
            )
        )
        await self.session.commit()

    async def reset_for_reconfiguration(self, signal_id: uuid.UUID) -> bool:
        """Delete processed artifacts and reset signal to AWAITING_CONFIG.

        Removes all child RunSegment rows and clears every processing field so
        the user can submit a fresh column configuration.  The raw uploaded file
        is intentionally left untouched.
        """
        await self.session.execute(
            delete(RunSegment).where(RunSegment.signal_id == signal_id)
        )
        result = await self.session.execute(
            update(SignalMetadata)
            .where(SignalMetadata.id == signal_id)
            .values(
                status=ProcessingStatus.AWAITING_CONFIG.value,
                time_column=None,
                signal_columns=None,
                channel_names=None,
                processed_file_path=None,
                error_message=None,
                total_points=None,
                active_run_count=0,
                updated_at=func.now(),
            )
        )
        await self.session.commit()
        return result.rowcount > 0

    # ── RunSegment CRUD ─────────────────────────────────────────────────────

    async def create_runs(
        self, signal_id: uuid.UUID, raw_runs: list[RawRun]
    ) -> list[RunSegment]:
        segments = [
            RunSegment(
                signal_id=signal_id,
                run_index=r.run_index,
                start_x=r.start_x,
                end_x=r.end_x,
                duration_seconds=r.duration_seconds,
                value_max=r.value_max,
                value_min=r.value_min,
                value_mean=r.value_mean,
                value_variance=r.value_variance,
            )
            for r in raw_runs
        ]
        self.session.add_all(segments)
        await self.session.commit()
        for s in segments:
            await self.session.refresh(s)
        return segments

    async def get_runs_by_ids(
        self, signal_id: uuid.UUID, run_ids: list[uuid.UUID]
    ) -> list[RunSegment]:
        result = await self.session.execute(
            select(RunSegment)
            .where(
                RunSegment.signal_id == signal_id,
                RunSegment.id.in_(run_ids),
            )
            .order_by(RunSegment.run_index)
        )
        return list(result.scalars().all())
