"""CSV parser for lot event bulk upload.

Pure function: takes raw CSV bytes and returns a tuple of
(valid_events, row_errors).  No I/O or DB calls — fully unit-testable.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC
from typing import TYPE_CHECKING

from app.core.exceptions import ValidationException
from app.domain.lot_event.schemas import LotEventCreate, RowError

if TYPE_CHECKING:
    pass

_REQUIRED_COLUMNS = {
    "lot_id",
    "check_in_time",
    "check_out_time",
    "recipe",
    "wafer_count",
}


def _parse_time(raw: str) -> float:
    """Convert an ISO 8601 string or numeric string to a Unix epoch float."""
    raw = raw.strip()
    try:
        return float(raw)
    except ValueError:
        pass
    try:
        from datetime import datetime

        # Try common formats; fall back to dateutil if available.
        for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S%z",
        ):
            try:
                dt = datetime.strptime(raw, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                return dt.timestamp()
            except ValueError:
                continue
        # Last resort: python-dateutil (optional dependency)
        try:
            from dateutil import parser as du_parser  # type: ignore[import-untyped]

            return du_parser.parse(raw).timestamp()
        except Exception:
            pass
    except Exception:
        pass
    raise ValueError(f"Cannot parse time value: '{raw}'")


def parse(file_bytes: bytes) -> tuple[list[LotEventCreate], list[RowError]]:
    """Parse CSV bytes into validated LotEventCreate objects.

    Args:
        file_bytes: Raw bytes of the uploaded CSV file.

    Returns:
        A 2-tuple of (valid_events, row_errors).  Row errors are collected and
        returned rather than raising, allowing partial import of valid rows.

    Raises:
        ValidationException: If required columns are entirely missing from the header.
    """
    text = file_bytes.decode("utf-8-sig").strip()
    reader = csv.DictReader(io.StringIO(text))

    headers = set(reader.fieldnames or [])
    missing = _REQUIRED_COLUMNS - headers
    if missing:
        raise ValidationException(
            f"Required column(s) missing from CSV: {', '.join(sorted(missing))}"
        )

    valid: list[LotEventCreate] = []
    errors: list[RowError] = []

    for row_num, row in enumerate(reader, start=2):  # row 1 = header
        lot_id_raw = (row.get("lot_id") or "").strip()
        try:
            check_in = _parse_time(row["check_in_time"])
            check_out = _parse_time(row["check_out_time"])
            wafer_count = int((row.get("wafer_count") or "").strip())
            recipe = (row.get("recipe") or "").strip()

            event = LotEventCreate(
                lot_id=lot_id_raw,
                recipe=recipe,
                wafer_count=wafer_count,
                check_in_time=check_in,
                check_out_time=check_out,
            )
            valid.append(event)
        except Exception as exc:
            errors.append(
                RowError(row=row_num, lot_id=lot_id_raw or None, reason=str(exc))
            )

    return valid, errors
