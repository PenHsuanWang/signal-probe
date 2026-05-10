"""LotEventService: use-case orchestration for lot event CRUD and lot slicing."""

import uuid

import polars as pl
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.lot_event.csv_parser import parse as parse_csv
from app.core.exceptions import ConflictException, NotFoundException
from app.domain.lot_event.repository import LotEventRepository
from app.domain.lot_event.schemas import (
    BulkImportResult,
    LotEventCreate,
    LotEventResponse,
    LotEventUpdate,
    RowError,
)
from app.domain.signal.enums import ProcessingStatus
from app.domain.signal.repository import SignalRepository
from app.domain.signal.schemas import (
    ChannelMacroData,
    MacroViewResponse,
    RunBound,
)


class LotEventService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.signal_repo = SignalRepository(session)
        self.lot_repo = LotEventRepository(session)

    # ── Ownership helper ──────────────────────────────────────────────────────

    async def _require_signal(self, signal_id: uuid.UUID, owner_id: uuid.UUID):
        """Return the signal record or raise 404/403 if not accessible."""
        signal = await self.signal_repo.get_signal(signal_id)
        if signal is None:
            raise NotFoundException("Signal not found.")
        if signal.owner_id != owner_id:
            raise NotFoundException("Signal not found.")
        return signal

    # ── CSV bulk import ───────────────────────────────────────────────────────

    async def upload_csv(
        self, signal_id: uuid.UUID, owner_id: uuid.UUID, file_bytes: bytes
    ) -> BulkImportResult:
        await self._require_signal(signal_id, owner_id)

        valid, parse_errors = parse_csv(file_bytes)
        if not valid:
            return BulkImportResult(
                imported=0, skipped=len(parse_errors), errors=parse_errors
            )

        skipped_errors: list[RowError] = list(parse_errors)
        imported = 0

        # Insert row by row so duplicate lot_ids within the file are individually
        # skipped rather than aborting the whole batch.
        for i, item in enumerate(valid, start=2):
            try:
                await self.lot_repo.create(signal_id, item)
                imported += 1
            except ConflictException:
                skipped_errors.append(
                    RowError(
                        row=i,
                        lot_id=item.lot_id,
                        reason=f"lot_id '{item.lot_id}' already exists — skipped.",
                    )
                )

        return BulkImportResult(
            imported=imported,
            skipped=len(skipped_errors),
            errors=skipped_errors,
        )

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def list_events(
        self, signal_id: uuid.UUID, owner_id: uuid.UUID
    ) -> list[LotEventResponse]:
        await self._require_signal(signal_id, owner_id)
        events = await self.lot_repo.list_by_signal(signal_id)
        return [LotEventResponse.model_validate(e) for e in events]

    async def create_event(
        self, signal_id: uuid.UUID, owner_id: uuid.UUID, data: LotEventCreate
    ) -> LotEventResponse:
        await self._require_signal(signal_id, owner_id)
        event = await self.lot_repo.create(signal_id, data)
        return LotEventResponse.model_validate(event)

    async def update_event(
        self,
        signal_id: uuid.UUID,
        event_id: uuid.UUID,
        owner_id: uuid.UUID,
        data: LotEventUpdate,
    ) -> LotEventResponse:
        await self._require_signal(signal_id, owner_id)
        event = await self.lot_repo.update(signal_id, event_id, data)
        return LotEventResponse.model_validate(event)

    async def delete_event(
        self, signal_id: uuid.UUID, event_id: uuid.UUID, owner_id: uuid.UUID
    ) -> None:
        await self._require_signal(signal_id, owner_id)
        deleted = await self.lot_repo.delete(signal_id, event_id)
        if not deleted:
            raise NotFoundException("Lot event not found.")

    # ── Lot slice ─────────────────────────────────────────────────────────────

    async def get_lot_slice(
        self, signal_id: uuid.UUID, lot_id: str, owner_id: uuid.UUID
    ) -> dict:
        """Return a MacroViewResponse-shaped dict sliced to the lot's time window.

        The x-axis is reset so that x=0 corresponds to check_in_time, making
        it easy to overlay multiple lots on the same chart.  t0_epoch_s is set
        to check_in_time so the frontend can reconstruct absolute datetime labels.
        """
        signal = await self._require_signal(signal_id, owner_id)

        if signal.status != ProcessingStatus.COMPLETED:
            raise ConflictException(f"Signal is not ready (status={signal.status})")
        if not signal.processed_file_path:
            raise ConflictException("Processed file not available.")

        lot = await self.lot_repo.get_by_lot_id(signal_id, lot_id)
        if lot is None:
            raise NotFoundException(f"Lot event '{lot_id}' not found for this signal.")

        df = pl.read_parquet(signal.processed_file_path)

        t0_epoch_s: float | None = (
            float(df["t0_epoch_s"][0]) if "t0_epoch_s" in df.columns else None
        )

        # Convert absolute epoch times to Parquet-relative x offsets.
        if t0_epoch_s is not None:
            x_start = lot.check_in_time - t0_epoch_s
            x_end = lot.check_out_time - t0_epoch_s
        else:
            # Fallback: treat check_in/out as elapsed-second offsets directly.
            x_start = lot.check_in_time
            x_end = lot.check_out_time

        sliced = df.filter(
            (pl.col("timestamp_s") >= x_start) & (pl.col("timestamp_s") <= x_end)
        )

        raw_x: list[float] = sliced["timestamp_s"].to_list()
        # Reset x-axis origin to check_in_time.
        x_reset: list[float] = [v - x_start for v in raw_x]

        channel_names: list[str] = [
            c.strip()
            for c in (signal.channel_names or "").split(",")
            if c.strip() and not c.strip().startswith("__")
        ]

        channels: list[ChannelMacroData] = []
        for ch_name in channel_names:
            if ch_name not in sliced.columns:
                continue
            y: list[float] = sliced[ch_name].to_list()
            state_col = f"{ch_name}_state"
            states: list[str] = (
                sliced[state_col].to_list()
                if state_col in sliced.columns
                else ["ok"] * len(y)
            )
            channels.append(ChannelMacroData(channel_name=ch_name, y=y, states=states))

        channel_units: dict[str, str] = {}
        for ch_name in channel_names:
            unit_key = f"__unit_{ch_name}"
            if unit_key in sliced.columns and len(sliced) > 0:
                raw_unit = sliced[unit_key][0]
                if raw_unit is not None:
                    channel_units[ch_name] = str(raw_unit)

        run_bounds = [
            RunBound(
                run_id=r.id,
                run_index=r.run_index,
                start_x=max(0.0, r.start_x - x_start),
                end_x=min(x_end - x_start, r.end_x - x_start),
            )
            for r in sorted(signal.runs, key=lambda r: r.run_index)
            if r.start_x < x_end and r.end_x > x_start
        ]

        macro = MacroViewResponse(
            signal_id=signal_id,
            x=x_reset,
            channels=channels,
            runs=run_bounds,
            t0_epoch_s=lot.check_in_time,
            channel_units=channel_units,
        )

        lot_event_data = LotEventResponse.model_validate(lot).model_dump()
        return {**macro.model_dump(), "lot_event": lot_event_data}
