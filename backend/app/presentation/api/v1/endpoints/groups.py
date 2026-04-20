import uuid

from fastapi import APIRouter, HTTPException, status

from app.application.group.service import GroupService
from app.domain.group.schemas import (
    GroupCreateRequest,
    GroupMemberResponse,
    GroupMemberUpsert,
    GroupResponse,
    GroupUpdateRequest,
)
from app.presentation.api.dependencies import CurrentUser, DbSession

router = APIRouter()


@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> GroupResponse:
    svc = GroupService(session)
    return await svc.create_group(current_user.id, body)


@router.get("", response_model=list[GroupResponse])
async def list_groups(
    session: DbSession,
    current_user: CurrentUser,
) -> list[GroupResponse]:
    svc = GroupService(session)
    return await svc.list_groups(current_user.id)


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(
    group_id: uuid.UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> GroupResponse:
    svc = GroupService(session)
    group = await svc.get_group(group_id)
    if group is None or group.owner_id != current_user.id:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: uuid.UUID,
    body: GroupUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> GroupResponse:
    svc = GroupService(session)
    # ownership check
    existing = await svc.get_group(group_id)
    if existing is None or existing.owner_id != current_user.id:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Group not found")
    result = await svc.update_group(group_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return result


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: uuid.UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> None:
    svc = GroupService(session)
    existing = await svc.get_group(group_id)
    if existing is None or existing.owner_id != current_user.id:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Group not found")
    deleted = await svc.delete_group(group_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Group not found")


@router.put("/{group_id}/members", response_model=GroupMemberResponse)
async def upsert_group_member(
    group_id: uuid.UUID,
    body: GroupMemberUpsert,
    session: DbSession,
    current_user: CurrentUser,
) -> GroupMemberResponse:
    svc = GroupService(session)
    existing = await svc.get_group(group_id)
    if existing is None or existing.owner_id != current_user.id:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Group not found")
    return await svc.upsert_member(group_id, body)


@router.delete(
    "/{group_id}/members/{signal_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_group_member(
    group_id: uuid.UUID,
    signal_id: uuid.UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> None:
    svc = GroupService(session)
    existing = await svc.get_group(group_id)
    if existing is None or existing.owner_id != current_user.id:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Group not found")
    removed = await svc.remove_member(group_id, signal_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Member not found")
