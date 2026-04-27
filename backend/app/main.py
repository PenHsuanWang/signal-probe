import logging
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.exceptions import (
    ConflictException,
    InfrastructureException,
    NotFoundException,
    ValidationException,
)
from app.infrastructure.executor import start_executor, stop_executor
from app.presentation.api.v1.router import api_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Start the process-pool executor before serving; shut it down cleanly."""
    start_executor()
    yield
    stop_executor()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a UUID request_id to every request and echo it in the response header."""

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


app.add_middleware(_RequestIdMiddleware)

app.include_router(api_router, prefix=settings.API_V1_STR)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", str(uuid.uuid4()))


@app.exception_handler(NotFoundException)
async def _not_found_exception_handler(
    request: Request, exc: NotFoundException
) -> JSONResponse:
    """Map NotFoundException → HTTP 404 using the standard error envelope."""
    return JSONResponse(
        status_code=404,
        content={
            "error": {
                "code": "NOT_FOUND",
                "message": exc.message,
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


@app.exception_handler(ConflictException)
async def _conflict_exception_handler(
    request: Request, exc: ConflictException
) -> JSONResponse:
    """Map ConflictException → HTTP 409 using the standard error envelope."""
    return JSONResponse(
        status_code=409,
        content={
            "error": {
                "code": "CONFLICT",
                "message": exc.message,
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


@app.exception_handler(ValidationException)
async def _domain_validation_exception_handler(
    request: Request, exc: ValidationException
) -> JSONResponse:
    """Map ValidationException → HTTP 422 using the standard error envelope."""
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "UNPROCESSABLE_ENTITY",
                "message": exc.message,
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


@app.exception_handler(InfrastructureException)
async def _infrastructure_exception_handler(
    request: Request, exc: InfrastructureException
) -> JSONResponse:
    """Map InfrastructureException → HTTP 500, logging the full traceback."""
    logger.error(
        "Infrastructure failure on %s %s — %s",
        request.method,
        request.url.path,
        exc.message,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "A storage or database error occurred.",
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Wrap HTTP errors in the standard error envelope."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": _http_status_to_code(exc.status_code),
                "message": exc.detail,
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Wrap Pydantic/FastAPI 422 validation errors in the standard error envelope."""
    details = [
        {"field": ".".join(str(loc) for loc in e["loc"]), "issue": e["msg"]}
        for e in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed.",
                "details": details,
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unexpected server errors — log and return a safe 500."""
    logger.exception(
        "Unhandled exception on %s %s",
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred.",
                "request_id": _request_id(request),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        },
    )


def _http_status_to_code(status_code: int) -> str:
    _MAP = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        422: "UNPROCESSABLE_ENTITY",
        429: "TOO_MANY_REQUESTS",
        500: "INTERNAL_SERVER_ERROR",
    }
    return _MAP.get(status_code, f"HTTP_{status_code}")


@app.get("/health")
async def health_check():
    return {"status": "ok"}
