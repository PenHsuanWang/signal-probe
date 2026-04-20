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


@router.get("", response_model=list[SignalMetadataResponse])
async def list_signals(
    session: DbSession,
    storage: StorageDep,
    current_user: CurrentUser,
) -> list[SignalMetadataResponse]:
    svc = SignalService(session, storage)
    return await svc.list_signals(current_user.id)


@router.get("/{signal_id}", response_model=SignalMetadataResponse)
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


@router.patch("/{signal_id}", response_model=SignalMetadataResponse)
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


@router.delete("/{signal_id}", status_code=status.HTTP_204_NO_CONTENT)
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


@router.get("/{signal_id}/macro", response_model=MacroViewResponse)
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
    try:
        return await svc.get_macro_view(signal_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{signal_id}/runs", response_model=list[RunChunkResponse])
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
    try:
        return await svc.get_run_chunks(signal_id, run_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
