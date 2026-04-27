"""LocalStorageAdapter: stores files on the local filesystem."""

import logging
import os

import aiofiles

from app.core.config import settings
from app.core.exceptions import InfrastructureException, ValidationException
from app.infrastructure.storage.interface import IStorageAdapter

logger = logging.getLogger(__name__)


class LocalStorageAdapter(IStorageAdapter):
    def __init__(self) -> None:
        self._base = os.path.abspath(settings.STORAGE_PATH)

    def _abs(self, relative_path: str) -> str:
        abs_path = os.path.normpath(os.path.join(self._base, relative_path))
        # Ensure the resolved path stays inside the storage root
        if abs_path != self._base and not abs_path.startswith(self._base + os.sep):
            raise ValidationException(
                f"Resolved path escapes storage root: {relative_path!r}"
            )
        return abs_path

    async def save(self, relative_path: str, data: bytes) -> str:
        abs_path = self._abs(relative_path)
        try:
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            async with aiofiles.open(abs_path, "wb") as f:
                await f.write(data)
        except OSError as exc:
            logger.error("Storage write failed for %r: %s", relative_path, exc)
            raise InfrastructureException(
                f"Failed to save file '{relative_path}': {exc}"
            ) from exc
        return abs_path

    async def read(self, absolute_path: str) -> bytes:
        try:
            async with aiofiles.open(absolute_path, "rb") as f:
                return await f.read()
        except FileNotFoundError:
            raise InfrastructureException(
                f"File not found in storage: '{absolute_path}'"
            )
        except OSError as exc:
            logger.error("Storage read failed for %r: %s", absolute_path, exc)
            raise InfrastructureException(
                f"Failed to read file '{absolute_path}': {exc}"
            ) from exc

    async def delete(self, absolute_path: str) -> None:
        try:
            os.remove(absolute_path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.error("Storage delete failed for %r: %s", absolute_path, exc)
            raise InfrastructureException(
                f"Failed to delete file '{absolute_path}': {exc}"
            ) from exc
