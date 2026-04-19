"""IStorageAdapter: interface (ABC) for blob/file storage."""

from abc import ABC, abstractmethod


class IStorageAdapter(ABC):
    @abstractmethod
    async def save(self, relative_path: str, data: bytes) -> str:
        """Persist `data` at `relative_path`. Returns the absolute path."""
        ...

    @abstractmethod
    async def read(self, absolute_path: str) -> bytes:
        """Return file bytes from an absolute path."""
        ...

    @abstractmethod
    async def delete(self, absolute_path: str) -> None:
        """Delete a file. Silently ignores missing files."""
        ...
