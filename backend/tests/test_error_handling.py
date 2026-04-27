"""Tests for the centralized error-handling strategy.

Verifies that each custom domain/infrastructure exception type is correctly
mapped to its expected HTTP status code and error envelope shape by the global
exception handlers registered in ``app/main.py``.

Tests use FastAPI's ``TestClient`` and patch service methods so the tests
remain database-free and fast.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.exceptions import (
    ConflictException,
    InfrastructureException,
    NotFoundException,
    ValidationException,
)
from app.main import app

client = TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _error_body(response) -> dict:
    """Return the ``error`` sub-object from a JSON response."""
    return response.json()["error"]


# ---------------------------------------------------------------------------
# Exception hierarchy unit tests
# ---------------------------------------------------------------------------


class TestExceptionHierarchy:
    """Verify that the new exception classes are correctly related."""

    def test_not_found_is_domain_exception(self):
        from app.core.exceptions import DomainException

        assert issubclass(NotFoundException, DomainException)

    def test_conflict_is_domain_exception(self):
        from app.core.exceptions import DomainException

        assert issubclass(ConflictException, DomainException)

    def test_validation_is_domain_exception(self):
        from app.core.exceptions import DomainException

        assert issubclass(ValidationException, DomainException)

    def test_infrastructure_is_not_domain_exception(self):
        from app.core.exceptions import DomainException

        assert not issubclass(InfrastructureException, DomainException)

    def test_each_exception_carries_message(self):
        exc = NotFoundException("test msg")
        assert exc.message == "test msg"

        exc2 = ConflictException("conflict msg")
        assert exc2.message == "conflict msg"

        exc3 = ValidationException("val msg")
        assert exc3.message == "val msg"

        exc4 = InfrastructureException("infra msg")
        assert exc4.message == "infra msg"

    def test_default_messages(self):
        assert NotFoundException().message == "Resource not found"
        assert ConflictException().message == "Resource state conflict"
        assert ValidationException().message == "Validation failed"
        assert InfrastructureException().message == "An infrastructure error occurred"


# ---------------------------------------------------------------------------
# Global handler HTTP mapping tests
# (inject exceptions through the /health route via dependency overrides)
# ---------------------------------------------------------------------------


def _make_raising_route(exc_instance):
    """Create a minimal FastAPI route that raises *exc_instance*."""
    from fastapi import APIRouter

    r = APIRouter()

    @r.get("/_test_raise")
    async def _raise():
        raise exc_instance

    return r


class TestGlobalExceptionHandlers:
    """Verify HTTP status codes produced by the global handlers."""

    def _get_raising_response(self, exc_instance):
        from fastapi import FastAPI
        from fastapi.exceptions import RequestValidationError
        from fastapi.testclient import TestClient
        from starlette.exceptions import HTTPException as StarletteHTTPException

        # Build a throwaway app with just the handlers and a single error route.
        from app.main import (
            _conflict_exception_handler,
            _domain_validation_exception_handler,
            _global_exception_handler,
            _http_exception_handler,
            _infrastructure_exception_handler,
            _not_found_exception_handler,
            _validation_exception_handler,
        )

        test_app = FastAPI()
        test_app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
        test_app.add_exception_handler(
            RequestValidationError, _validation_exception_handler
        )
        test_app.add_exception_handler(NotFoundException, _not_found_exception_handler)
        test_app.add_exception_handler(ConflictException, _conflict_exception_handler)
        test_app.add_exception_handler(
            ValidationException, _domain_validation_exception_handler
        )
        test_app.add_exception_handler(
            InfrastructureException, _infrastructure_exception_handler
        )
        test_app.add_exception_handler(Exception, _global_exception_handler)

        @test_app.get("/_test_raise")
        async def _raise():
            raise exc_instance

        tc = TestClient(test_app, raise_server_exceptions=False)
        return tc.get("/_test_raise")

    def test_not_found_maps_to_404(self):
        resp = self._get_raising_response(NotFoundException("thing not here"))
        assert resp.status_code == 404
        body = _error_body(resp)
        assert body["code"] == "NOT_FOUND"
        assert body["message"] == "thing not here"
        assert "request_id" in body
        assert "timestamp" in body

    def test_conflict_maps_to_409(self):
        resp = self._get_raising_response(ConflictException("already processing"))
        assert resp.status_code == 409
        body = _error_body(resp)
        assert body["code"] == "CONFLICT"
        assert body["message"] == "already processing"

    def test_validation_maps_to_422(self):
        resp = self._get_raising_response(ValidationException("bad column 'x'"))
        assert resp.status_code == 422
        body = _error_body(resp)
        assert body["code"] == "UNPROCESSABLE_ENTITY"
        assert body["message"] == "bad column 'x'"

    def test_infrastructure_maps_to_500(self):
        resp = self._get_raising_response(InfrastructureException("disk full"))
        assert resp.status_code == 500
        body = _error_body(resp)
        assert body["code"] == "INTERNAL_SERVER_ERROR"
        # Infrastructure errors do NOT leak internal details to client.
        assert "disk full" not in body["message"]

    def test_generic_exception_maps_to_500(self):
        resp = self._get_raising_response(RuntimeError("oops"))
        assert resp.status_code == 500
        body = _error_body(resp)
        assert body["code"] == "INTERNAL_SERVER_ERROR"

    def test_error_envelope_always_has_required_fields(self):
        for exc in [
            NotFoundException("x"),
            ConflictException("y"),
            ValidationException("z"),
            InfrastructureException("w"),
        ]:
            resp = self._get_raising_response(exc)
            body = _error_body(resp)
            assert "code" in body
            assert "message" in body
            assert "request_id" in body
            assert "timestamp" in body


# ---------------------------------------------------------------------------
# Service-layer domain exception tests (unit, no HTTP)
# ---------------------------------------------------------------------------


class TestUserServiceDomainExceptions:
    @pytest.mark.anyio
    async def test_create_user_raises_conflict_for_duplicate_email(self):
        from unittest.mock import AsyncMock, MagicMock

        from app.application.user.service import UserService

        mock_session = MagicMock()
        svc = UserService(mock_session)
        # Simulate existing user
        svc.repo = MagicMock()
        svc.repo.get_by_email = AsyncMock(return_value=MagicMock())

        with pytest.raises(ConflictException, match="already exists"):
            from app.domain.user.schemas import UserCreate

            await svc.create_user(
                UserCreate(email="dup@test.com", password="secret123")
            )


class TestSignalServiceDomainExceptions:
    @pytest.mark.anyio
    async def test_get_raw_columns_raises_conflict_when_not_awaiting_config(self):
        import uuid

        from app.application.signal.service import SignalService
        from app.domain.signal.enums import ProcessingStatus

        mock_session = MagicMock()
        mock_storage = MagicMock()
        svc = SignalService(mock_session, mock_storage)

        fake_signal = MagicMock()
        fake_signal.status = ProcessingStatus.COMPLETED
        svc.repo = MagicMock()
        svc.repo.get_signal = AsyncMock(return_value=fake_signal)

        with pytest.raises(ConflictException, match="awaiting configuration"):
            await svc.get_raw_columns(uuid.uuid4())

    @pytest.mark.anyio
    async def test_reconfigure_raises_conflict_when_processing(self):
        import uuid

        from app.application.signal.service import SignalService
        from app.domain.signal.enums import ProcessingStatus

        mock_session = MagicMock()
        mock_storage = MagicMock()
        svc = SignalService(mock_session, mock_storage)

        fake_signal = MagicMock()
        fake_signal.status = ProcessingStatus.PROCESSING
        svc.repo = MagicMock()
        svc.repo.get_signal = AsyncMock(return_value=fake_signal)

        with pytest.raises(ConflictException, match="being processed"):
            await svc.reconfigure_signal(uuid.uuid4())

    @pytest.mark.anyio
    async def test_get_macro_view_raises_conflict_when_not_completed(self):
        import uuid

        from app.application.signal.service import SignalService
        from app.domain.signal.enums import ProcessingStatus

        mock_session = MagicMock()
        mock_storage = MagicMock()
        svc = SignalService(mock_session, mock_storage)

        fake_signal = MagicMock()
        fake_signal.status = ProcessingStatus.PENDING
        svc.repo = MagicMock()
        svc.repo.get_signal = AsyncMock(return_value=fake_signal)

        with pytest.raises(ConflictException, match="not ready"):
            await svc.get_macro_view(uuid.uuid4())

    @pytest.mark.anyio
    async def test_process_signal_raises_validation_for_unknown_time_column(
        self, tmp_path
    ):
        """ValidationException raised for unknown time_column (not KeyError)."""
        import uuid

        from app.application.signal.service import SignalService
        from app.domain.signal.enums import ProcessingStatus
        from app.domain.signal.schemas import ProcessSignalRequest

        # Write a minimal CSV so _load_raw_dataframe can read it
        csv_file = tmp_path / "signal.csv"
        csv_file.write_text("time,value\n0,1\n1,2\n")

        mock_session = MagicMock()
        mock_storage = MagicMock()
        svc = SignalService(mock_session, mock_storage)

        fake_signal = MagicMock()
        fake_signal.status = ProcessingStatus.AWAITING_CONFIG
        fake_signal.file_path = str(csv_file)
        fake_signal.id = uuid.uuid4()
        svc.repo = MagicMock()
        svc.repo.get_signal = AsyncMock(return_value=fake_signal)

        req = ProcessSignalRequest(
            csv_format="wide",
            time_column="nonexistent_col",
            signal_columns=["value"],
        )

        with pytest.raises(ValidationException, match="nonexistent_col"):
            await svc.process_signal(fake_signal.id, req, MagicMock())


class TestSTFTServiceDomainExceptions:
    def test_infer_sampling_rate_raises_validation_on_single_sample(self):
        import numpy as np

        from app.application.analysis.stft_service import _infer_sampling_rate

        with pytest.raises(ValidationException, match="at least 2"):
            _infer_sampling_rate(np.array([0.0]))

    def test_infer_sampling_rate_raises_validation_on_non_monotone(self):
        import numpy as np

        from app.application.analysis.stft_service import _infer_sampling_rate

        # All same timestamp → median diff = 0
        with pytest.raises(ValidationException, match="non-positive"):
            _infer_sampling_rate(np.array([1.0, 1.0, 1.0]))


# ---------------------------------------------------------------------------
# Infrastructure layer unit tests
# ---------------------------------------------------------------------------


class TestLocalStorageAdapterExceptions:
    @pytest.mark.anyio
    async def test_save_raises_infrastructure_on_oserror(self, tmp_path, monkeypatch):
        from app.infrastructure.storage.local import LocalStorageAdapter

        adapter = LocalStorageAdapter.__new__(LocalStorageAdapter)
        adapter._base = str(tmp_path)

        # Patch os.makedirs to raise OSError to avoid needing a real aiofiles mock
        import os as _os

        monkeypatch.setattr(
            _os,
            "makedirs",
            lambda *a, **kw: (_ for _ in ()).throw(OSError("disk full")),
        )

        with pytest.raises(InfrastructureException, match="disk full"):
            await adapter.save("test.csv", b"data")

    @pytest.mark.anyio
    async def test_read_raises_infrastructure_on_missing_file(self, tmp_path):
        from app.infrastructure.storage.local import LocalStorageAdapter

        adapter = LocalStorageAdapter.__new__(LocalStorageAdapter)
        adapter._base = str(tmp_path)

        with pytest.raises(InfrastructureException, match="not found"):
            await adapter.read(str(tmp_path / "nonexistent.csv"))

    def test_abs_raises_validation_on_path_traversal(self, tmp_path):
        from app.infrastructure.storage.local import LocalStorageAdapter

        adapter = LocalStorageAdapter.__new__(LocalStorageAdapter)
        adapter._base = str(tmp_path)

        with pytest.raises(ValidationException, match="escapes storage root"):
            adapter._abs("../../etc/passwd")
