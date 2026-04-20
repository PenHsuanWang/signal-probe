"""Unit tests for the signal ingestion pipeline.

Covers:
- Long/stacked CSV format detection (_is_stacked_format)
- Stacked reader: channel separation, time alignment, sorted channel order
- Stacked reader: outer-join alignment when channels have different time ranges
- Stacked reader: deduplication of duplicate (datetime, signal_name) rows
- Stacked reader: case-insensitive column detection
- Wide-format reader: backward-compatible behaviour (unchanged path)
- Dispatcher: routes to correct reader based on format
- Edge cases: single channel in stacked format, empty file handling
"""

import os

import polars as pl
import pytest

from app.application.signal.pipeline import (
    _is_stacked_format,
    _read_signal_file,
    _read_stacked_signal_file,
    _read_wide_signal_file,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_stacked_df(rows: list[tuple]) -> pl.DataFrame:
    """Build a stacked DataFrame from (datetime_str, signal_name, value) tuples."""
    datetimes, names, values = zip(*rows)
    return pl.DataFrame(
        {
            "datetime": pl.Series(list(datetimes)).str.to_datetime("%Y-%m-%d %H:%M:%S"),
            "signal_name": list(names),
            "signal_value": pl.Series(list(values), dtype=pl.Float64),
        }
    )


def _write_stacked_csv(rows: list[tuple], path: str) -> None:
    """Write a stacked CSV file with header datetime,signal_name,signal_value."""
    with open(path, "w") as f:
        f.write("datetime,signal_name,signal_value\n")
        for dt, name, val in rows:
            f.write(f"{dt},{name},{val}\n")


def _write_wide_csv(rows: list[tuple], header: list[str], path: str) -> None:
    """Write a wide-format CSV file."""
    with open(path, "w") as f:
        f.write(",".join(header) + "\n")
        for row in rows:
            f.write(",".join(str(v) for v in row) + "\n")


# ── _is_stacked_format ────────────────────────────────────────────────────────


class TestIsStackedFormat:
    def test_detects_stacked_with_exact_columns(self):
        df = _make_stacked_df([("2026-01-01 00:00:00", "s1", 1.0)])
        assert _is_stacked_format(df) is True

    def test_detects_stacked_case_insensitive(self):
        df = pl.DataFrame(
            {
                "DateTime": ["2026-01-01 00:00:00"],
                "Signal_Name": ["s1"],
                "Signal_Value": [1.0],
            }
        )
        assert _is_stacked_format(df) is True

    def test_rejects_wide_format(self):
        df = pl.DataFrame({"timestamp": [0.0, 1.0], "sensor_a": [1.0, 2.0]})
        assert _is_stacked_format(df) is False

    def test_rejects_missing_one_required_column(self):
        df = pl.DataFrame({"datetime": ["2026-01-01"], "signal_value": [1.0]})
        assert _is_stacked_format(df) is False

    def test_accepts_stacked_with_extra_columns(self):
        df = pl.DataFrame(
            {
                "datetime": ["2026-01-01 00:00:00"],
                "signal_name": ["s1"],
                "signal_value": [1.0],
                "extra_col": ["ignored"],
            }
        )
        assert _is_stacked_format(df) is True


# ── _read_stacked_signal_file ─────────────────────────────────────────────────


class TestReadStackedSignalFile:
    def test_two_channels_identical_time_range(self):
        rows = [
            ("2026-01-01 00:00:00", "signal_1", 1.0),
            ("2026-01-01 00:01:00", "signal_1", 2.0),
            ("2026-01-01 00:02:00", "signal_1", 3.0),
            ("2026-01-01 00:00:00", "signal_2", 10.0),
            ("2026-01-01 00:01:00", "signal_2", 20.0),
            ("2026-01-01 00:02:00", "signal_2", 30.0),
        ]
        df = _make_stacked_df(rows)
        ts, channels = _read_stacked_signal_file(df)

        assert len(ts) == 3
        assert ts[0] == pytest.approx(0.0)
        assert ts[1] == pytest.approx(60.0)
        assert ts[2] == pytest.approx(120.0)

        assert set(channels.keys()) == {"signal_1", "signal_2"}
        assert channels["signal_1"] == [1.0, 2.0, 3.0]
        assert channels["signal_2"] == [10.0, 20.0, 30.0]

    def test_channels_sorted_alphabetically(self):
        rows = [
            ("2026-01-01 00:00:00", "z_channel", 9.0),
            ("2026-01-01 00:00:00", "a_channel", 1.0),
            ("2026-01-01 00:00:00", "m_channel", 5.0),
        ]
        df = _make_stacked_df(rows)
        _, channels = _read_stacked_signal_file(df)
        assert list(channels.keys()) == ["a_channel", "m_channel", "z_channel"]

    def test_outer_join_alignment_fills_none_for_missing_timestamps(self):
        """Channel A has t0,t1,t2; channel B has t0,t2 only (missing t1)."""
        rows = [
            ("2026-01-01 00:00:00", "ch_a", 1.0),
            ("2026-01-01 00:01:00", "ch_a", 2.0),
            ("2026-01-01 00:02:00", "ch_a", 3.0),
            ("2026-01-01 00:00:00", "ch_b", 10.0),
            # ch_b missing at 00:01:00
            ("2026-01-01 00:02:00", "ch_b", 30.0),
        ]
        df = _make_stacked_df(rows)
        ts, channels = _read_stacked_signal_file(df)

        assert len(ts) == 3
        assert channels["ch_a"] == [1.0, 2.0, 3.0]
        assert channels["ch_b"][0] == pytest.approx(10.0)
        assert channels["ch_b"][1] is None  # missing
        assert channels["ch_b"][2] == pytest.approx(30.0)

    def test_outer_join_alignment_extra_timestamps_in_one_channel(self):
        """Channel B has an extra timestamp t3 not present in channel A."""
        rows = [
            ("2026-01-01 00:00:00", "ch_a", 1.0),
            ("2026-01-01 00:01:00", "ch_a", 2.0),
            ("2026-01-01 00:00:00", "ch_b", 10.0),
            ("2026-01-01 00:01:00", "ch_b", 20.0),
            ("2026-01-01 00:02:00", "ch_b", 30.0),  # extra
        ]
        df = _make_stacked_df(rows)
        ts, channels = _read_stacked_signal_file(df)

        assert len(ts) == 3
        assert channels["ch_a"][-1] is None  # ch_a missing at t3
        assert channels["ch_b"][-1] == pytest.approx(30.0)

    def test_timestamps_start_at_zero(self):
        rows = [
            ("2026-04-20 06:30:00", "sig", 1.0),
            ("2026-04-20 06:31:00", "sig", 2.0),
        ]
        df = _make_stacked_df(rows)
        ts, _ = _read_stacked_signal_file(df)
        assert ts[0] == pytest.approx(0.0)
        assert ts[1] == pytest.approx(60.0)

    def test_deduplicates_duplicate_datetime_signal_name(self):
        """Duplicate (datetime, signal_name) rows → keep first occurrence."""
        rows = [
            ("2026-01-01 00:00:00", "s1", 1.0),
            ("2026-01-01 00:00:00", "s1", 99.0),  # duplicate — should be ignored
            ("2026-01-01 00:01:00", "s1", 2.0),
        ]
        df = _make_stacked_df(rows)
        ts, channels = _read_stacked_signal_file(df)
        assert len(ts) == 2
        assert channels["s1"][0] == pytest.approx(1.0)

    def test_single_channel_stacked(self):
        rows = [
            ("2026-01-01 00:00:00", "only_signal", 5.0),
            ("2026-01-01 00:01:00", "only_signal", 6.0),
        ]
        df = _make_stacked_df(rows)
        ts, channels = _read_stacked_signal_file(df)
        assert list(channels.keys()) == ["only_signal"]
        assert ts == pytest.approx([0.0, 60.0])

    def test_case_insensitive_column_names(self):
        """Columns named with mixed case are still detected and normalised."""
        df = pl.DataFrame(
            {
                "DateTime": pl.Series(["2026-01-01 00:00:00"]).str.to_datetime(
                    "%Y-%m-%d %H:%M:%S"
                ),
                "Signal_Name": ["s1"],
                "Signal_Value": pl.Series([1.0], dtype=pl.Float64),
            }
        )
        ts, channels = _read_stacked_signal_file(df)
        assert len(ts) == 1
        assert "s1" in channels

    def test_raises_on_empty_dataframe_after_cleaning(self):
        df = pl.DataFrame(
            {
                "datetime": pl.Series([], dtype=pl.Datetime),
                "signal_name": pl.Series([], dtype=pl.Utf8),
                "signal_value": pl.Series([], dtype=pl.Float64),
            }
        )
        with pytest.raises(ValueError, match="no valid rows"):
            _read_stacked_signal_file(df)

    def test_five_channels_full_alignment(self):
        """Simulate the real signal_data.csv structure: 5 channels, same timestamps."""
        n = 10
        rows = []
        for ch in range(1, 6):
            for i in range(n):
                ts_str = f"2026-04-20 00:{i:02d}:00"
                rows.append((ts_str, f"signal_{ch}", float(ch * i)))
        df = _make_stacked_df(rows)
        ts, channels = _read_stacked_signal_file(df)

        assert len(ts) == n
        assert len(channels) == 5
        # All channels fully populated (no None)
        for ch_vals in channels.values():
            assert all(v is not None for v in ch_vals)


# ── _read_wide_signal_file ────────────────────────────────────────────────────


class TestReadWideSignalFile:
    def test_numeric_time_column_two_channels(self):
        df = pl.DataFrame(
            {
                "time": [0.0, 1.0, 2.0],
                "ch_a": [1.0, 2.0, 3.0],
                "ch_b": [4.0, 5.0, 6.0],
            }
        )
        ts, channels = _read_wide_signal_file(df)
        assert ts == pytest.approx([0.0, 1.0, 2.0])
        assert channels["ch_a"] == [1.0, 2.0, 3.0]
        assert channels["ch_b"] == [4.0, 5.0, 6.0]

    def test_single_value_column_uses_row_index(self):
        df = pl.DataFrame({"value": [10.0, 20.0, 30.0]})
        ts, channels = _read_wide_signal_file(df)
        assert ts == pytest.approx([0.0, 1.0, 2.0])
        assert channels["value"] == [10.0, 20.0, 30.0]

    def test_elapsed_time_starts_at_zero(self):
        df = pl.DataFrame({"time": [100.0, 110.0, 120.0], "val": [1.0, 2.0, 3.0]})
        ts, _ = _read_wide_signal_file(df)
        assert ts[0] == pytest.approx(0.0)
        assert ts[1] == pytest.approx(10.0)

    def test_raises_on_no_numeric_columns(self):
        df = pl.DataFrame({"a": ["x", "y"], "b": ["p", "q"]})
        with pytest.raises(ValueError, match="no usable numeric columns"):
            _read_wide_signal_file(df)


# ── _read_signal_file dispatcher ─────────────────────────────────────────────


class TestReadSignalFileDispatcher:
    def test_dispatches_to_stacked_reader_for_stacked_csv(self, tmp_path):
        csv_path = str(tmp_path / "stacked.csv")
        _write_stacked_csv(
            [
                ("2026-01-01 00:00:00", "sig_a", 1.0),
                ("2026-01-01 00:01:00", "sig_a", 2.0),
                ("2026-01-01 00:00:00", "sig_b", 3.0),
                ("2026-01-01 00:01:00", "sig_b", 4.0),
            ],
            csv_path,
        )
        ts, channels = _read_signal_file(csv_path)
        assert set(channels.keys()) == {"sig_a", "sig_b"}
        assert ts[0] == pytest.approx(0.0)

    def test_dispatches_to_wide_reader_for_wide_csv(self, tmp_path):
        csv_path = str(tmp_path / "wide.csv")
        _write_wide_csv(
            [(0, 1.0, 10.0), (1, 2.0, 20.0), (2, 3.0, 30.0)],
            header=["time", "channel_a", "channel_b"],
            path=csv_path,
        )
        ts, channels = _read_signal_file(csv_path)
        assert set(channels.keys()) == {"channel_a", "channel_b"}
        assert ts[0] == pytest.approx(0.0)

    def test_stacked_csv_produces_correct_elapsed_seconds(self, tmp_path):
        csv_path = str(tmp_path / "stacked_timing.csv")
        _write_stacked_csv(
            [
                ("2026-04-20 00:00:00", "sig", 0.0),
                ("2026-04-20 00:01:00", "sig", 1.0),
                ("2026-04-20 00:02:00", "sig", 2.0),
            ],
            csv_path,
        )
        ts, _ = _read_signal_file(csv_path)
        assert ts == pytest.approx([0.0, 60.0, 120.0])

    def test_real_signal_data_csv(self):
        """Integration smoke-test against the actual data/signal_data.csv."""
        # backend/tests/ → backend/ → repo root
        repo_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        csv_path = os.path.join(repo_root, "data", "signal_data.csv")
        if not os.path.exists(csv_path):
            pytest.skip("data/signal_data.csv not found; skipping integration test")

        ts, channels = _read_signal_file(csv_path)

        assert len(channels) == 5
        assert set(channels.keys()) == {
            "signal_1",
            "signal_2",
            "signal_3",
            "signal_4",
            "signal_5",
        }
        assert len(ts) == 1440
        assert ts[0] == pytest.approx(0.0)
        assert ts[1] == pytest.approx(60.0)
        assert ts[-1] == pytest.approx(86_340.0)  # 23 h 59 min in seconds

        # No None gaps: all channels share the same 1440 timestamps
        for ch_name, ch_vals in channels.items():
            none_count = sum(1 for v in ch_vals if v is None)
            assert none_count == 0, f"{ch_name} has unexpected None gaps"


# ── Classifier null-safety ────────────────────────────────────────────────────


class TestClassifierNullSafety:
    """Verify classifier handles None values (from time-aligned stacked data)."""

    def test_classify_accepts_none_values(self):
        from app.domain.signal.algorithms.classifier import classify

        values = [1.0, None, 2.0, None, 3.0]
        states = classify(values)
        assert len(states) == 5
        # None positions are classified (not raised)
        valid_states = {"IDLE", "ACTIVE", "OOC"}
        assert all(s in valid_states for s in states)

    def test_none_positions_classified_as_idle(self):
        """Isolated None in a flat signal window → low variance → IDLE."""
        from app.domain.signal.algorithms.classifier import classify

        values = [0.0] * 60 + [None] + [0.0] * 60
        states = classify(values)
        assert states[60] == "IDLE"
