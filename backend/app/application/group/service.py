"""GroupService: use-case orchestration for signal group management."""

import json
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.group.repository import GroupRepository
from app.domain.group.schemas import (
    GroupCreateRequest,
    GroupMemberResponse,
    GroupMemberUpsert,
    GroupResponse,
    GroupUpdateRequest,
)


class GroupService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = GroupRepository(session)

    async def create_group(
        self, owner_id: uuid.UUID, req: GroupCreateRequest
    ) -> GroupResponse:
        group = await self.repo.create_group(
            owner_id=owner_id, name=req.name, description=req.description
        )
        return GroupResponse.model_validate(group)

    async def list_groups(self, owner_id: uuid.UUID) -> list[GroupResponse]:
        groups = await self.repo.list_groups(owner_id)
        return [GroupResponse.model_validate(g) for g in groups]

    async def get_group(self, group_id: uuid.UUID) -> GroupResponse | None:
        group = await self.repo.get_group(group_id)
        return GroupResponse.model_validate(group) if group else None

    async def update_group(
        self, group_id: uuid.UUID, req: GroupUpdateRequest
    ) -> GroupResponse | None:
        await self.repo.update_group(
            group_id, name=req.name, description=req.description
        )
        group = await self.repo.get_group(group_id)
        return GroupResponse.model_validate(group) if group else None

    async def delete_group(self, group_id: uuid.UUID) -> bool:
        return await self.repo.delete_group(group_id)

    async def upsert_member(
        self, group_id: uuid.UUID, req: GroupMemberUpsert
    ) -> GroupMemberResponse:
        member = await self.repo.upsert_member(
            group_id=group_id,
            signal_id=req.signal_id,
            display_order=req.display_order,
            channel_colors=json.dumps(req.channel_colors),
            time_offset_s=req.time_offset_s,
        )
        return GroupMemberResponse.model_validate(member)

    async def remove_member(self, group_id: uuid.UUID, signal_id: uuid.UUID) -> bool:
        return await self.repo.remove_member(group_id, signal_id)
