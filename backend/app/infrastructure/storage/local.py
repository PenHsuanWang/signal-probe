"""LocalStorageAdapter: stores files on the local filesystem."""

import os

import aiofiles

from app.core.config import settings
from app.infrastructure.storage.interface import IStorageAdapter


class LocalStorageAdapter(IStorageAdapter):
    def __init__(self) -> None:
        self._base = os.path.abspath(settings.STORAGE_PATH)

    def _abs(self, relative_path: str) -> str:
        abs_path = os.path.normpath(os.path.join(self._base, relative_path))
        # Ensure the resolved path stays inside the storage root
        if abs_path != self._base and not abs_path.startswith(self._base + os.sep):
            raise ValueError(f"Resolved path escapes storage root: {relative_path!r}")
        return abs_path

    async def save(self, relative_path: str, data: bytes) -> str:
        abs_path = self._abs(relative_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        async with aiofiles.open(abs_path, "wb") as f:
            await f.write(data)
        return abs_path

    async def read(self, absolute_path: str) -> bytes:
        async with aiofiles.open(absolute_path, "rb") as f:
            return await f.read()

    async def delete(self, absolute_path: str) -> None:
        try:
            os.remove(absolute_path)
        except FileNotFoundError:
            pass
