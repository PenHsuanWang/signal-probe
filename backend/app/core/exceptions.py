from fastapi import HTTPException, status


class CredentialsException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Domain exception hierarchy
# Domain / application layers raise these; the presentation layer (main.py)
# maps them to HTTP status codes.  No FastAPI imports below this line.
# ---------------------------------------------------------------------------


class DomainException(Exception):
    """Base class for all business-logic errors.

    Every subclass must carry a human-readable ``message`` attribute so that
    the global exception handlers can surface it directly to the client.
    """

    def __init__(self, message: str = "A domain error occurred") -> None:
        super().__init__(message)
        self.message = message


class NotFoundException(DomainException):
    """Raised when a requested resource does not exist.

    Maps to HTTP 404 Not Found.
    """

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message)


class ConflictException(DomainException):
    """Raised when an operation cannot proceed due to a resource-state conflict.

    Maps to HTTP 409 Conflict.
    Examples: signal not yet COMPLETED, duplicate resource creation,
    SQLAlchemy IntegrityError on a unique constraint.
    """

    def __init__(self, message: str = "Resource state conflict") -> None:
        super().__init__(message)


class ValidationException(DomainException):
    """Raised when user-supplied data violates a business rule.

    Maps to HTTP 422 Unprocessable Entity.
    Examples: unknown column name submitted by the user, invalid time window,
    time_column also present in signal_columns.
    """

    def __init__(self, message: str = "Validation failed") -> None:
        super().__init__(message)


# ---------------------------------------------------------------------------
# Infrastructure exception hierarchy
# Raised by storage adapters and repository layers to signal I/O or DB failures.
# Maps to HTTP 500 and is always logged with full traceback.
# ---------------------------------------------------------------------------


class InfrastructureException(Exception):
    """Raised when an external system (filesystem, database) fails unexpectedly.

    Maps to HTTP 500 Internal Server Error.
    The global handler logs the full traceback so operators can diagnose the
    root cause without exposing internal details to the client.
    """

    def __init__(self, message: str = "An infrastructure error occurred") -> None:
        super().__init__(message)
        self.message = message
