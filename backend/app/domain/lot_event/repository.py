import logging
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictException,
    InfrastructureException,
    NotFoundException,
)
from app.domain.lot_event.models import LotEvent
from app.domain.lot_event.schemas import LotEventCreate, LotEventUpdate

logger = logging.getLogger(__name__)


class LotEventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, signal_id: uuid.UUID, data: LotEventCreate) -> LotEvent:
        event = LotEvent(signal_id=signal_id, **data.model_dump())
        self.session.add(event)
        try:
            await self.session.commit()
            await self.session.refresh(event)
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictException(
                f"Lot ID '{data.lot_id}' already exists for this signal."
            ) from exc
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error(
                "DB error creating lot event for signal %s: %s", signal_id, exc
            )
            raise InfrastructureException(
                "Database error while creating lot event."
            ) from exc
        return event

    async def bulk_create(
        self, signal_id: uuid.UUID, items: list[LotEventCreate]
    ) -> list[LotEvent]:
        events = [LotEvent(signal_id=signal_id, **item.model_dump()) for item in items]
        self.session.add_all(events)
        try:
            await self.session.commit()
            for e in events:
                await self.session.refresh(e)
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error(
                "DB error bulk-creating lot events for signal %s: %s", signal_id, exc
            )
            raise InfrastructureException(
                "Database error during bulk lot event import."
            ) from exc
        return events

    async def list_by_signal(self, signal_id: uuid.UUID) -> list[LotEvent]:
        try:
            result = await self.session.execute(
                select(LotEvent)
                .where(LotEvent.signal_id == signal_id)
                .order_by(LotEvent.check_in_time)
            )
            return list(result.scalars().all())
        except SQLAlchemyError as exc:
            logger.error(
                "DB error listing lot events for signal %s: %s", signal_id, exc
            )
            raise InfrastructureException(
                "Database error while listing lot events."
            ) from exc

    async def get(self, signal_id: uuid.UUID, event_id: uuid.UUID) -> LotEvent | None:
        try:
            result = await self.session.execute(
                select(LotEvent).where(
                    LotEvent.id == event_id, LotEvent.signal_id == signal_id
                )
            )
            return result.scalars().first()
        except SQLAlchemyError as exc:
            logger.error("DB error fetching lot event %s: %s", event_id, exc)
            raise InfrastructureException(
                "Database error while fetching lot event."
            ) from exc

    async def get_by_lot_id(self, signal_id: uuid.UUID, lot_id: str) -> LotEvent | None:
        try:
            result = await self.session.execute(
                select(LotEvent).where(
                    LotEvent.signal_id == signal_id, LotEvent.lot_id == lot_id
                )
            )
            return result.scalars().first()
        except SQLAlchemyError as exc:
            logger.error("DB error fetching lot event by lot_id %s: %s", lot_id, exc)
            raise InfrastructureException(
                "Database error while fetching lot event."
            ) from exc

    async def update(
        self, signal_id: uuid.UUID, event_id: uuid.UUID, data: LotEventUpdate
    ) -> LotEvent:
        values = {k: v for k, v in data.model_dump().items() if v is not None}
        if not values:
            event = await self.get(signal_id, event_id)
            if event is None:
                raise NotFoundException("Lot event not found.")
            return event
        try:
            result = await self.session.execute(
                update(LotEvent)
                .where(LotEvent.id == event_id, LotEvent.signal_id == signal_id)
                .values(**values)
                .returning(LotEvent)
            )
            await self.session.commit()
            updated = result.scalars().first()
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error("DB error updating lot event %s: %s", event_id, exc)
            raise InfrastructureException(
                "Database error while updating lot event."
            ) from exc
        if updated is None:
            raise NotFoundException("Lot event not found.")
        return updated

    async def delete(self, signal_id: uuid.UUID, event_id: uuid.UUID) -> bool:
        try:
            result = await self.session.execute(
                delete(LotEvent).where(
                    LotEvent.id == event_id, LotEvent.signal_id == signal_id
                )
            )
            await self.session.commit()
            return result.rowcount > 0
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error("DB error deleting lot event %s: %s", event_id, exc)
            raise InfrastructureException(
                "Database error while deleting lot event."
            ) from exc
