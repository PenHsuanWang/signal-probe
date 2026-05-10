"""Tests for lot event CSV parser and schema validation."""

import pytest

from app.application.lot_event.csv_parser import parse
from app.core.exceptions import ValidationException
from app.domain.lot_event.schemas import LotEventCreate

# ── csv_parser tests ─────────────────────────────────────────────────────────


def _make_csv(*rows: str) -> bytes:
    header = "lot_id,recipe,wafer_count,check_in_time,check_out_time"
    return ("\n".join([header] + list(rows))).encode()


def test_parse_valid_epoch_floats():
    csv_bytes = _make_csv(
        "LOT001,RecipeA,25,1700000000.0,1700001000.0",
        "LOT002,RecipeB,24,1700001000.0,1700002000.0",
    )
    valid, errors = parse(csv_bytes)
    assert len(valid) == 2
    assert len(errors) == 0
    assert valid[0].lot_id == "LOT001"
    assert valid[0].wafer_count == 25
    assert valid[1].check_in_time == pytest.approx(1700001000.0)


def test_parse_iso8601_timestamps():
    csv_bytes = _make_csv(
        "LOT003,RecipeC,10,2024-01-15T08:00:00,2024-01-15T09:00:00",
    )
    valid, errors = parse(csv_bytes)
    assert len(valid) == 1
    assert len(errors) == 0
    # check_out > check_in
    assert valid[0].check_out_time > valid[0].check_in_time


def test_parse_missing_required_columns():
    csv_bytes = b"lot_id,check_in_time\nLOT001,1700000000.0"
    with pytest.raises(ValidationException, match="Required column"):
        parse(csv_bytes)


def test_parse_skips_invalid_rows_and_collects_errors():
    csv_bytes = _make_csv(
        "LOT001,RecipeA,25,1700000000.0,1700001000.0",  # valid
        "LOT002,RecipeB,abc,1700001000.0,1700002000.0",  # bad wafer_count
        "LOT003,RecipeC,5,1700002000.0,1700001000.0",  # checkout before checkin
    )
    valid, errors = parse(csv_bytes)
    assert len(valid) == 1
    assert len(errors) == 2
    assert valid[0].lot_id == "LOT001"


def test_parse_bom_utf8():
    """Handles CSV files saved with BOM (UTF-8-SIG)."""
    body = (
        "lot_id,recipe,wafer_count,check_in_time,check_out_time\nLOT1,R,5,100.0,200.0"
    )
    csv_bytes = b"\xef\xbb\xbf" + body.encode("utf-8")
    valid, errors = parse(csv_bytes)
    assert len(valid) == 1


# ── LotEventCreate schema tests ───────────────────────────────────────────────


def test_schema_rejects_checkout_before_checkin():
    with pytest.raises(Exception, match="check_out_time must be after"):
        LotEventCreate(
            lot_id="L1",
            recipe="R",
            wafer_count=5,
            check_in_time=200.0,
            check_out_time=100.0,
        )


def test_schema_rejects_zero_wafer_count():
    with pytest.raises(Exception):
        LotEventCreate(
            lot_id="L1",
            recipe="R",
            wafer_count=0,
            check_in_time=100.0,
            check_out_time=200.0,
        )


def test_schema_accepts_valid():
    evt = LotEventCreate(
        lot_id="LOT-X",
        recipe="RecipeX",
        wafer_count=25,
        check_in_time=1_000_000.0,
        check_out_time=1_003_600.0,
    )
    assert evt.lot_id == "LOT-X"
