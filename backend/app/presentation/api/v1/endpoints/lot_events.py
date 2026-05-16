import uuid

from fastapi import APIRouter, UploadFile, status

from app.application.lot_event.service import LotEventService
from app.domain.lot_event.schemas import (
    BulkImportResult,
    LotEventCreate,
    LotEventResponse,
    LotEventUpdate,
)
from app.presentation.api.dependencies import CurrentUser, DbSession

router = APIRouter()

_MAX_CSV_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post(
    "/{signal_id}/lot-events/upload-csv",
    response_model=BulkImportResult,
    status_code=status.HTTP_200_OK,
    summary="Bulk-import lot events from a CSV file",
)
async def upload_lot_events_csv(
    signal_id: uuid.UUID,
    file: UploadFile,
    session: DbSession,
    current_user: CurrentUser,
) -> BulkImportResult:
    """Bulk-import lot events from a CSV file.

    Required columns: lot_id, recipe, wafer_count, check_in_time, check_out_time.
    Times may be ISO 8601 strings or Unix epoch floats.
    Duplicate lot IDs are skipped and reported without aborting the rest.
    """
    raw = await file.read(_MAX_CSV_BYTES)
    svc = LotEventService(session)
    return await svc.upload_csv(signal_id, current_user.id, raw)


@router.get(
    "/{signal_id}/lot-events",
    response_model=list[LotEventResponse],
    summary="List lot events for a signal",
)
async def list_lot_events(
    signal_id: uuid.UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> list[LotEventResponse]:
    svc = LotEventService(session)
    return await svc.list_events(signal_id, current_user.id)


@router.post(
    "/{signal_id}/lot-events",
    response_model=LotEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Manually create a lot event",
)
async def create_lot_event(
    signal_id: uuid.UUID,
    body: LotEventCreate,
    session: DbSession,
    current_user: CurrentUser,
) -> LotEventResponse:
    svc = LotEventService(session)
    return await svc.create_event(signal_id, current_user.id, body)


@router.patch(
    "/{signal_id}/lot-events/{event_id}",
    response_model=LotEventResponse,
    summary="Update a lot event",
)
async def update_lot_event(
    signal_id: uuid.UUID,
    event_id: uuid.UUID,
    body: LotEventUpdate,
    session: DbSession,
    current_user: CurrentUser,
) -> LotEventResponse:
    svc = LotEventService(session)
    return await svc.update_event(signal_id, event_id, current_user.id, body)


@router.delete(
    "/{signal_id}/lot-events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a lot event",
)
async def delete_lot_event(
    signal_id: uuid.UUID,
    event_id: uuid.UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> None:
    svc = LotEventService(session)
    await svc.delete_event(signal_id, event_id, current_user.id)


@router.get(
    "/{signal_id}/lot-slice/{lot_id}",
    summary="Get a Parquet slice for a specific lot",
)
async def get_lot_slice(
    signal_id: uuid.UUID,
    lot_id: str,
    session: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Get a Parquet slice for a specific lot.

    Returns a MacroViewResponse-shaped payload covering the lot's
    check_in → check_out window. The x-axis resets to 0 at check_in_time.
    Includes an extra `lot_event` field with the lot metadata.
    """
    svc = LotEventService(session)
    return await svc.get_lot_slice(signal_id, lot_id, current_user.id)
