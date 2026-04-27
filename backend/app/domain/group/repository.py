import logging
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictException, InfrastructureException
from app.domain.group.models import SignalGroup, SignalGroupMember

logger = logging.getLogger(__name__)


class GroupRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_group(
        self, owner_id: uuid.UUID, name: str, description: str | None
    ) -> SignalGroup:
        group = SignalGroup(owner_id=owner_id, name=name, description=description)
        self.session.add(group)
        try:
            await self.session.commit()
            await self.session.refresh(group)
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictException(
                "Group creation failed due to a database constraint violation."
            ) from exc
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error("Database error creating group: %s", exc)
            raise InfrastructureException(
                "Database error while creating group."
            ) from exc
        return group

    async def list_groups(self, owner_id: uuid.UUID) -> list[SignalGroup]:
        try:
            result = await self.session.execute(
                select(SignalGroup)
                .where(SignalGroup.owner_id == owner_id)
                .options(selectinload(SignalGroup.members))
                .order_by(SignalGroup.created_at.desc())
            )
            return list(result.scalars().all())
        except SQLAlchemyError as exc:
            logger.error(
                "Database error listing groups for owner %s: %s", owner_id, exc
            )
            raise InfrastructureException(
                "Database error while listing groups."
            ) from exc

    async def get_group(self, group_id: uuid.UUID) -> SignalGroup | None:
        try:
            result = await self.session.execute(
                select(SignalGroup)
                .where(SignalGroup.id == group_id)
                .options(selectinload(SignalGroup.members))
            )
            return result.scalars().first()
        except SQLAlchemyError as exc:
            logger.error("Database error fetching group %s: %s", group_id, exc)
            raise InfrastructureException(
                "Database error while fetching group."
            ) from exc

    async def update_group(
        self,
        group_id: uuid.UUID,
        name: str | None,
        description: str | None,
    ) -> bool:
        values: dict = {}
        if name is not None:
            values["name"] = name
        if description is not None:
            values["description"] = description
        if not values:
            return True
        try:
            result = await self.session.execute(
                update(SignalGroup).where(SignalGroup.id == group_id).values(**values)
            )
            await self.session.commit()
            return result.rowcount > 0
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error("Database error updating group %s: %s", group_id, exc)
            raise InfrastructureException(
                "Database error while updating group."
            ) from exc

    async def delete_group(self, group_id: uuid.UUID) -> bool:
        try:
            result = await self.session.execute(
                delete(SignalGroup).where(SignalGroup.id == group_id)
            )
            await self.session.commit()
            return result.rowcount > 0
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error("Database error deleting group %s: %s", group_id, exc)
            raise InfrastructureException(
                "Database error while deleting group."
            ) from exc

    async def upsert_member(
        self,
        group_id: uuid.UUID,
        signal_id: uuid.UUID,
        display_order: int,
        channel_colors: str,
        time_offset_s: float,
    ) -> SignalGroupMember:
        try:
            result = await self.session.execute(
                select(SignalGroupMember).where(
                    SignalGroupMember.group_id == group_id,
                    SignalGroupMember.signal_id == signal_id,
                )
            )
            member = result.scalars().first()
            if member:
                member.display_order = display_order
                member.channel_colors = channel_colors
                member.time_offset_s = time_offset_s
            else:
                member = SignalGroupMember(
                    group_id=group_id,
                    signal_id=signal_id,
                    display_order=display_order,
                    channel_colors=channel_colors,
                    time_offset_s=time_offset_s,
                )
                self.session.add(member)
            await self.session.commit()
            await self.session.refresh(member)
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictException(
                "Member upsert failed due to a database constraint violation."
            ) from exc
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error(
                "Database error upserting member signal=%s in group=%s: %s",
                signal_id,
                group_id,
                exc,
            )
            raise InfrastructureException(
                "Database error while updating group member."
            ) from exc
        return member

    async def remove_member(self, group_id: uuid.UUID, signal_id: uuid.UUID) -> bool:
        try:
            result = await self.session.execute(
                delete(SignalGroupMember).where(
                    SignalGroupMember.group_id == group_id,
                    SignalGroupMember.signal_id == signal_id,
                )
            )
            await self.session.commit()
            return result.rowcount > 0
        except SQLAlchemyError as exc:
            await self.session.rollback()
            logger.error(
                "Database error removing member signal=%s from group=%s: %s",
                signal_id,
                group_id,
                exc,
            )
            raise InfrastructureException(
                "Database error while removing group member."
            ) from exc
