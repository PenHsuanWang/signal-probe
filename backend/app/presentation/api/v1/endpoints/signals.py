import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from app.application.signal.service import SignalService
from app.db.session import AsyncSessionLocal
from app.domain.signal.schemas import (
    MacroViewResponse,
    ProcessSignalRequest,
    RawColumnsResponse,
    RunChunkResponse,
    SignalMetadataResponse,
    SignalRenameRequest,
)
from app.presentation.api.dependencies import CurrentUser, DbSession, StorageDep

router = APIRouter()

_MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post(
    "/upload",
    response_model=SignalMetadataResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a signal CSV file",
)
async def upload_signal(
    file: UploadFile,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> SignalMetadataResponse:
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds 100 MB limit",
        )
    svc = SignalService(session, storage)
    signal = await svc.upload_signal(
        owner_id=current_user.id,
        filename=file.filename or "upload.csv",
        file_bytes=data,
        session_factory=AsyncSessionLocal,
    )
    return SignalMetadataResponse.model_validate(signal)


@router.get(
    "",
    response_model=list[SignalMetadataResponse],
    summary="List all signals for the current user",
)
async def list_signals(
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> list[SignalMetadataResponse]:
    svc = SignalService(session, storage)
    return await svc.list_signals(current_user.id)


@router.get(
    "/{signal_id}",
    response_model=SignalMetadataResponse,
    summary="Get a signal by ID",
)
async def get_signal(
    signal_id: uuid.UUID,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> SignalMetadataResponse:
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    return SignalMetadataResponse.model_validate(signal)


@router.patch(
    "/{signal_id}",
    response_model=SignalMetadataResponse,
    summary="Rename a signal",
)
async def rename_signal(
    signal_id: uuid.UUID,
    body: SignalRenameRequest,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> SignalMetadataResponse:
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    result = await svc.rename_signal(signal_id, body.original_filename)
    if result is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return result


@router.delete(
    "/{signal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a signal and all its artifacts",
)
async def delete_signal(
    signal_id: uuid.UUID,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> None:
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    deleted = await svc.delete_signal(signal_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Signal not found")


@router.get(
    "/{signal_id}/macro",
    response_model=MacroViewResponse,
    summary="Get full macro-view data for a completed signal",
)
async def get_macro_view(
    signal_id: uuid.UUID,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> MacroViewResponse:
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    return await svc.get_macro_view(signal_id)


@router.get(
    "/{signal_id}/runs",
    response_model=list[RunChunkResponse],
    summary="Get detailed run-chunk data for selected run IDs",
)
async def get_run_chunks(
    signal_id: uuid.UUID,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
    run_ids: Annotated[list[uuid.UUID], Query(alias="run_ids")] = [],
) -> list[RunChunkResponse]:
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    return await svc.get_run_chunks(signal_id, run_ids)


@router.get(
    "/{signal_id}/raw-columns",
    response_model=RawColumnsResponse,
    summary="Preview raw file columns for configuration",
)
async def get_raw_columns(
    signal_id: uuid.UUID,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> RawColumnsResponse:
    """Return column descriptors (name, dtype, samples) for the raw uploaded file.

    Only available when the signal is in ``AWAITING_CONFIG`` state.
    """
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    return await svc.get_raw_columns(signal_id)


@router.post(
    "/{signal_id}/process",
    response_model=SignalMetadataResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit column config and trigger processing pipeline",
)
async def process_signal(
    signal_id: uuid.UUID,
    body: ProcessSignalRequest,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> SignalMetadataResponse:
    """Validate user-selected ``time_column`` + ``signal_columns``.

    Starts the processing pipeline.  The signal must be in ``AWAITING_CONFIG``
    state.  Column names are validated server-side against the actual file
    headers before the pipeline is queued.
    server-side against the actual file headers before the pipeline is queued.
    """
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    result = await svc.process_signal(signal_id, body, AsyncSessionLocal)
    return SignalMetadataResponse.model_validate(result)


@router.post(
    "/{signal_id}/reconfigure",
    response_model=SignalMetadataResponse,
    summary="Reset signal to AWAITING_CONFIG, clearing processed artifacts",
)
async def reconfigure_signal(
    signal_id: uuid.UUID,
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> SignalMetadataResponse:
    """Reset a ``COMPLETED`` or ``FAILED`` signal so the user can reselect columns.

    All run segments and the processed Parquet file are deleted.
    The raw uploaded file is preserved.
    """
    svc = SignalService(session, storage)
    signal = await svc.get_signal(signal_id)
    if signal is None or signal.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    result = await svc.reconfigure_signal(signal_id)
    return SignalMetadataResponse.model_validate(result)
