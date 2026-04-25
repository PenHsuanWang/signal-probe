import uuid
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.presentation.api.v1.router import api_router

app = FastAPI(
    title=settings.PROJECT_NAME, openapi_url=f"{settings.API_V1_STR}/openapi.json"
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
    """Wrap unexpected server errors in the standard error envelope."""
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
