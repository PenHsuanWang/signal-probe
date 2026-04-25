from fastapi import HTTPException, status


class CredentialsException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


class NotFoundException(Exception):
    """Raised by service/repository layers when a requested resource does not exist.

    Maps to HTTP 404 Not Found at the presentation layer.
    Kept as a plain Exception (not HTTPException) to preserve Clean Architecture:
    domain and application layers must not import FastAPI.
    """

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message)
        self.message = message


class ConflictException(Exception):
    """Raised when an operation cannot proceed due to resource state conflicts.

    Maps to HTTP 409 Conflict at the presentation layer.
    Examples: signal not yet COMPLETED, duplicate resource creation.
    """

    def __init__(self, message: str = "Resource state conflict") -> None:
        super().__init__(message)
        self.message = message
