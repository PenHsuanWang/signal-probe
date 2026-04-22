"""Unit tests for the signal ingestion pipeline.

Covers:
- Long/stacked CSV format detection (_is_stacked_format)
- Stacked reader: channel separation, time alignment, sorted channel order
- Stacked reader: outer-join alignment when channels have different time ranges
- Stacked reader: deduplication of duplicate (datetime, signal_name) rows
- Stacked reader: case-insensitive column detection
- Stacked reader: channel_filter selects a subset of channels
- Stacked reader: channel_filter with all-unknown names raises ValueError
- Wide-format reader: backward-compatible behaviour (unchanged path)
- Dispatcher: routes to correct reader based on format
- Edge cases: single channel in stacked format, empty file handling
- ColumnInspector.detect_csv_format: detects wide vs stacked, enumerates names
- ProcessSignalRequest: model validator rejects invalid combinations
- Alias column names: measurement_datetime/measurement_value are treated as stacked
"""

import os

import polars as pl
import pytest

from app.application.signal.pipeline import (
    _is_stacked_format,
    _read_signal_file,
    _read_stacked_signal_file,
    _read_wide_signal_file,
    _read_with_config,
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


def _write_alias_stacked_csv(rows: list[tuple], path: str) -> None:
    """Write a stacked CSV using vendor alias column names.

    Mimics files that use ``measurement_datetime`` / ``measurement_value``
    (plus extra ``equipment`` and ``unit`` columns) instead of the canonical
    ``datetime`` / ``signal_value`` names.
    """
    with open(path, "w") as f:
        f.write("equipment,signal_name,measurement_datetime,measurement_value,unit\n")
        for dt, name, val in rows:
            f.write(f"MACHINE|CH1,{name},{dt},{val},psig\n")


def _make_alias_stacked_df(rows: list[tuple]) -> pl.DataFrame:
    """Build a stacked DataFrame with alias column names.

    Uses ``measurement_datetime`` / ``measurement_value`` instead of the
    canonical ``datetime`` / ``signal_value``, plus extra ``equipment`` and
    ``unit`` columns — matching the vendor CSV format described in ADR-009.
    """
    datetimes, names, values = zip(*rows)
    return pl.DataFrame(
        {
            "equipment": ["MACHINE|CH1"] * len(datetimes),
            "signal_name": list(names),
            "measurement_datetime": pl.Series(list(datetimes)).str.to_datetime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "measurement_value": pl.Series(list(values), dtype=pl.Float64),
            "unit": ["psig"] * len(datetimes),
        }
    )


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
        ts, channels, _ = _read_stacked_signal_file(df)

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
        _, channels, _ = _read_stacked_signal_file(df)
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
        ts, channels, _ = _read_stacked_signal_file(df)

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
        ts, channels, _ = _read_stacked_signal_file(df)

        assert len(ts) == 3
        assert channels["ch_a"][-1] is None  # ch_a missing at t3
        assert channels["ch_b"][-1] == pytest.approx(30.0)

    def test_timestamps_start_at_zero(self):
        rows = [
            ("2026-04-20 06:30:00", "sig", 1.0),
            ("2026-04-20 06:31:00", "sig", 2.0),
        ]
        df = _make_stacked_df(rows)
        ts, _, _ = _read_stacked_signal_file(df)
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
        ts, channels, _ = _read_stacked_signal_file(df)
        assert len(ts) == 2
        assert channels["s1"][0] == pytest.approx(1.0)

    def test_single_channel_stacked(self):
        rows = [
            ("2026-01-01 00:00:00", "only_signal", 5.0),
            ("2026-01-01 00:01:00", "only_signal", 6.0),
        ]
        df = _make_stacked_df(rows)
        ts, channels, _ = _read_stacked_signal_file(df)
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
        ts, channels, _ = _read_stacked_signal_file(df)
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

    def test_t0_epoch_s_is_unix_epoch_of_first_timestamp(self):
        """t0_epoch_s must equal the Unix epoch (seconds) of the earliest row."""
        rows = [
            ("2026-04-20 00:00:00", "sig", 1.0),
            ("2026-04-20 00:01:00", "sig", 2.0),
        ]
        df = _make_stacked_df(rows)
        _, _, t0_epoch_s = _read_stacked_signal_file(df)
        assert t0_epoch_s == pytest.approx(1776643200.0)

    def test_five_channels_full_alignment(self):
        """Simulate the real signal_data.csv structure: 5 channels, same timestamps."""
        n = 10
        rows = []
        for ch in range(1, 6):
            for i in range(n):
                ts_str = f"2026-04-20 00:{i:02d}:00"
                rows.append((ts_str, f"signal_{ch}", float(ch * i)))
        df = _make_stacked_df(rows)
        ts, channels, _ = _read_stacked_signal_file(df)

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
        ts, channels, _ = _read_wide_signal_file(df)
        assert ts == pytest.approx([0.0, 1.0, 2.0])
        assert channels["ch_a"] == [1.0, 2.0, 3.0]
        assert channels["ch_b"] == [4.0, 5.0, 6.0]

    def test_single_value_column_uses_row_index(self):
        df = pl.DataFrame({"value": [10.0, 20.0, 30.0]})
        ts, channels, _ = _read_wide_signal_file(df)
        assert ts == pytest.approx([0.0, 1.0, 2.0])
        assert channels["value"] == [10.0, 20.0, 30.0]

    def test_elapsed_time_starts_at_zero(self):
        df = pl.DataFrame({"time": [100.0, 110.0, 120.0], "val": [1.0, 2.0, 3.0]})
        ts, _, _ = _read_wide_signal_file(df)
        assert ts[0] == pytest.approx(0.0)
        assert ts[1] == pytest.approx(10.0)

    def test_raises_on_no_numeric_columns(self):
        df = pl.DataFrame({"a": ["x", "y"], "b": ["p", "q"]})
        with pytest.raises(ValueError, match="no usable numeric columns"):
            _read_wide_signal_file(df)

    def test_temporal_time_column_elapsed_seconds(self):
        """Wide file with a datetime first column: elapsed in seconds, not μs."""
        df = pl.DataFrame(
            {
                "ts": pl.Series(
                    [
                        "2026-04-20 00:00:00",
                        "2026-04-20 00:01:00",
                        "2026-04-20 00:02:00",
                    ]
                ).str.to_datetime("%Y-%m-%d %H:%M:%S"),
                "val": [1.0, 2.0, 3.0],
            }
        )
        ts, channels, t0_epoch_s = _read_wide_signal_file(df)
        assert ts == pytest.approx([0.0, 60.0, 120.0])
        assert channels["val"] == [1.0, 2.0, 3.0]
        assert t0_epoch_s is not None
        assert t0_epoch_s == pytest.approx(1776643200.0)

    def test_temporal_time_column_returns_t0_epoch_s(self):
        """t0_epoch_s must be None for numeric time columns."""
        df = pl.DataFrame({"time": [0.0, 1.0], "val": [10.0, 20.0]})
        _, _, t0_epoch_s = _read_wide_signal_file(df)
        assert t0_epoch_s is None


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
        ts, channels, _ = _read_signal_file(csv_path)
        assert set(channels.keys()) == {"sig_a", "sig_b"}
        assert ts[0] == pytest.approx(0.0)

    def test_dispatches_to_wide_reader_for_wide_csv(self, tmp_path):
        csv_path = str(tmp_path / "wide.csv")
        _write_wide_csv(
            [(0, 1.0, 10.0), (1, 2.0, 20.0), (2, 3.0, 30.0)],
            header=["time", "channel_a", "channel_b"],
            path=csv_path,
        )
        ts, channels, _ = _read_signal_file(csv_path)
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
        ts, _, _ = _read_signal_file(csv_path)
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

        ts, channels, _ = _read_signal_file(csv_path)

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


# ── _read_with_config ─────────────────────────────────────────────────────────


class TestReadWithConfig:
    """Verify explicit column-config reader with numeric and temporal time columns."""

    def test_numeric_time_column(self, tmp_path):
        csv_path = str(tmp_path / "wide_numeric.csv")
        _write_wide_csv(
            [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)],
            header=["ts", "val"],
            path=csv_path,
        )
        ts, channels, t0_epoch_s = _read_with_config(csv_path, "ts", ["val"])
        assert ts == pytest.approx([0.0, 1.0, 2.0])
        assert channels["val"] == [1.0, 2.0, 3.0]
        assert t0_epoch_s is None

    def test_temporal_time_column_elapsed_seconds(self, tmp_path):
        """Datetime time column must produce elapsed seconds, not μs."""
        csv_path = str(tmp_path / "wide_datetime.csv")
        with open(csv_path, "w") as f:
            f.write("timestamp,sensor_a\n")
            f.write("2026-04-20 00:00:00,10.0\n")
            f.write("2026-04-20 00:01:00,20.0\n")
            f.write("2026-04-20 00:02:00,30.0\n")
        ts, channels, t0_epoch_s = _read_with_config(
            csv_path, "timestamp", ["sensor_a"]
        )
        assert ts == pytest.approx([0.0, 60.0, 120.0])
        assert channels["sensor_a"] == [10.0, 20.0, 30.0]
        assert t0_epoch_s is not None
        assert t0_epoch_s == pytest.approx(1776643200.0)

    def test_temporal_column_t0_epoch_s_consistent_with_iso(self, tmp_path):
        """t0_epoch_s must equal the Unix epoch of the first timestamp."""
        import datetime

        csv_path = str(tmp_path / "wide_datetime_epoch.csv")
        with open(csv_path, "w") as f:
            f.write("ts,val\n")
            f.write("2000-01-01 00:00:00,1.0\n")
            f.write("2000-01-01 00:00:01,2.0\n")
        _, _, t0_epoch_s = _read_with_config(csv_path, "ts", ["val"])
        assert t0_epoch_s is not None
        # 2000-01-01 00:00:00 UTC in epoch seconds
        expected = datetime.datetime(
            2000, 1, 1, 0, 0, 0, tzinfo=datetime.UTC
        ).timestamp()
        assert t0_epoch_s == pytest.approx(expected, rel=1e-3)

    def test_missing_column_raises(self, tmp_path):
        csv_path = str(tmp_path / "wide.csv")
        _write_wide_csv([(0.0, 1.0)], header=["ts", "val"], path=csv_path)
        with pytest.raises(ValueError, match="not found in file"):
            _read_with_config(csv_path, "missing_col", ["val"])


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


# ── channel_filter in _read_stacked_signal_file ───────────────────────────────


class TestReadStackedChannelFilter:
    """Verify the channel_filter parameter selects a subset of channels."""

    def test_filter_single_channel(self):
        rows = [
            ("2026-01-01 00:00:00", "ch_a", 1.0),
            ("2026-01-01 00:01:00", "ch_a", 2.0),
            ("2026-01-01 00:00:00", "ch_b", 10.0),
            ("2026-01-01 00:01:00", "ch_b", 20.0),
        ]
        df = _make_stacked_df(rows)
        _, channels, _ = _read_stacked_signal_file(df, channel_filter=["ch_a"])
        assert list(channels.keys()) == ["ch_a"]
        assert channels["ch_a"] == [1.0, 2.0]

    def test_filter_subset_of_channels(self):
        rows = [
            ("2026-01-01 00:00:00", "alpha", 1.0),
            ("2026-01-01 00:00:00", "beta", 2.0),
            ("2026-01-01 00:00:00", "gamma", 3.0),
        ]
        df = _make_stacked_df(rows)
        _, channels, _ = _read_stacked_signal_file(
            df, channel_filter=["alpha", "gamma"]
        )
        assert set(channels.keys()) == {"alpha", "gamma"}
        assert "beta" not in channels

    def test_filter_none_includes_all_channels(self):
        rows = [
            ("2026-01-01 00:00:00", "x", 1.0),
            ("2026-01-01 00:00:00", "y", 2.0),
        ]
        df = _make_stacked_df(rows)
        _, channels, _ = _read_stacked_signal_file(df, channel_filter=None)
        assert set(channels.keys()) == {"x", "y"}

    def test_filter_with_unknown_names_raises(self):
        rows = [("2026-01-01 00:00:00", "real_ch", 1.0)]
        df = _make_stacked_df(rows)
        with pytest.raises(ValueError, match="None of the requested channel names"):
            _read_stacked_signal_file(df, channel_filter=["nonexistent"])

    def test_filter_preserves_timestamps(self):
        """Timestamps cover the union of all channels even after filtering."""
        rows = [
            ("2026-01-01 00:00:00", "a", 1.0),
            ("2026-01-01 00:01:00", "a", 2.0),
            ("2026-01-01 00:02:00", "a", 3.0),
            ("2026-01-01 00:00:00", "b", 10.0),
            ("2026-01-01 00:01:00", "b", 20.0),
            ("2026-01-01 00:02:00", "b", 30.0),
        ]
        df = _make_stacked_df(rows)
        ts, channels, _ = _read_stacked_signal_file(df, channel_filter=["a"])
        assert len(ts) == 3
        assert ts == pytest.approx([0.0, 60.0, 120.0])
        assert channels["a"] == [1.0, 2.0, 3.0]


# ── ColumnInspector.detect_csv_format ────────────────────────────────────────


class TestColumnInspectorDetectFormat:
    """Verify format detection and stacked signal-name enumeration."""

    def test_detects_wide_format(self, tmp_path):
        csv_path = str(tmp_path / "wide.csv")
        _write_wide_csv(
            [(0, 1.0, 10.0), (1, 2.0, 20.0)],
            header=["time", "ch_a", "ch_b"],
            path=csv_path,
        )
        from app.application.signal.column_inspector import ColumnInspector

        fmt, names = ColumnInspector().detect_csv_format(csv_path)
        assert fmt == "wide"
        assert names == []

    def test_detects_stacked_format(self, tmp_path):
        csv_path = str(tmp_path / "stacked.csv")
        _write_stacked_csv(
            [
                ("2026-01-01 00:00:00", "sensor_a", 1.0),
                ("2026-01-01 00:01:00", "sensor_a", 2.0),
                ("2026-01-01 00:00:00", "sensor_b", 3.0),
            ],
            csv_path,
        )
        from app.application.signal.column_inspector import ColumnInspector

        fmt, names = ColumnInspector().detect_csv_format(csv_path)
        assert fmt == "stacked"
        assert sorted(names) == ["sensor_a", "sensor_b"]

    def test_stacked_signal_names_sorted(self, tmp_path):
        csv_path = str(tmp_path / "stacked_sorted.csv")
        _write_stacked_csv(
            [
                ("2026-01-01 00:00:00", "z_ch", 1.0),
                ("2026-01-01 00:00:00", "a_ch", 2.0),
                ("2026-01-01 00:00:00", "m_ch", 3.0),
            ],
            csv_path,
        )
        from app.application.signal.column_inspector import ColumnInspector

        _, names = ColumnInspector().detect_csv_format(csv_path)
        assert names == ["a_ch", "m_ch", "z_ch"]

    def test_stacked_enumerates_all_signal_names_in_large_file(self, tmp_path):
        """Names that appear only after the first 100 rows are still enumerated."""
        csv_path = str(tmp_path / "large_stacked.csv")
        # Generate 150 rows for channel_1, then 1 row for channel_late.
        rows = [
            (f"2026-01-01 00:{i // 60:02d}:{i % 60:02d}", "channel_1", float(i))
            for i in range(150)
        ] + [("2026-01-01 02:30:00", "channel_late", 999.0)]
        _write_stacked_csv(rows, csv_path)

        from app.application.signal.column_inspector import ColumnInspector

        fmt, names = ColumnInspector().detect_csv_format(csv_path)
        assert fmt == "stacked"
        assert "channel_1" in names
        assert "channel_late" in names


# ── ProcessSignalRequest validation ──────────────────────────────────────────


class TestProcessSignalRequestValidation:
    """Verify the model validator for wide vs stacked format fields."""

    def test_wide_format_requires_time_column(self):
        from pydantic import ValidationError

        from app.domain.signal.schemas import ProcessSignalRequest

        with pytest.raises(ValidationError, match="time_column is required"):
            ProcessSignalRequest(
                csv_format="wide",
                signal_columns=["ch_a"],
            )

    def test_wide_format_requires_signal_columns(self):
        from pydantic import ValidationError

        from app.domain.signal.schemas import ProcessSignalRequest

        with pytest.raises(ValidationError, match="signal_columns is required"):
            ProcessSignalRequest(
                csv_format="wide",
                time_column="ts",
            )

    def test_wide_format_valid(self):
        from app.domain.signal.schemas import ProcessSignalRequest

        req = ProcessSignalRequest(
            csv_format="wide",
            time_column="ts",
            signal_columns=["ch_a", "ch_b"],
        )
        assert req.time_column == "ts"
        assert req.signal_columns == ["ch_a", "ch_b"]

    def test_stacked_format_no_filter_is_valid(self):
        from app.domain.signal.schemas import ProcessSignalRequest

        req = ProcessSignalRequest(csv_format="stacked")
        assert req.stacked_channel_filter is None

    def test_stacked_format_with_filter(self):
        from app.domain.signal.schemas import ProcessSignalRequest

        req = ProcessSignalRequest(
            csv_format="stacked",
            stacked_channel_filter=["sig_1", "sig_2"],
        )
        assert req.stacked_channel_filter == ["sig_1", "sig_2"]

    def test_stacked_format_empty_filter_raises(self):
        from pydantic import ValidationError

        from app.domain.signal.schemas import ProcessSignalRequest

        with pytest.raises(
            ValidationError, match="stacked_channel_filter must not be an empty list"
        ):
            ProcessSignalRequest(
                csv_format="stacked",
                stacked_channel_filter=[],
            )

    def test_default_format_is_wide_when_fields_provided(self):
        from app.domain.signal.schemas import ProcessSignalRequest

        # Omitting csv_format should default to "wide"
        req = ProcessSignalRequest(
            time_column="time",
            signal_columns=["val"],
        )
        assert req.csv_format == "wide"


# ── Alias column-name support ─────────────────────────────────────────────────


class TestIsStackedFormatAliases:
    """_is_stacked_format must recognise measurement_datetime/measurement_value."""

    def test_detects_alias_columns_as_stacked(self):
        df = _make_alias_stacked_df([("2026-01-01 00:00:00", "s1", 1.0)])
        assert _is_stacked_format(df) is True

    def test_alias_columns_mixed_with_extra_cols(self):
        """Extra columns (equipment, unit) must not block detection."""
        df = _make_alias_stacked_df(
            [
                ("2026-01-01 00:00:00", "s1", 1.0),
                ("2026-01-01 00:01:00", "s1", 2.0),
            ]
        )
        assert _is_stacked_format(df) is True

    def test_only_one_alias_column_is_not_stacked(self):
        """Partial alias match must not trigger stacked detection."""
        df = pl.DataFrame(
            {
                "signal_name": ["s1"],
                "measurement_datetime": ["2026-01-01 00:00:00"],
                # measurement_value missing → only datetime alias present
            }
        )
        assert _is_stacked_format(df) is False


class TestReadStackedSignalFileAliases:
    """_read_stacked_signal_file must parse alias-column DataFrames correctly."""

    def test_reads_two_channels_from_alias_df(self):
        rows = [
            ("2026-01-01 00:00:00", "ch_a", 1.0),
            ("2026-01-01 00:01:00", "ch_a", 2.0),
            ("2026-01-01 00:00:00", "ch_b", 10.0),
            ("2026-01-01 00:01:00", "ch_b", 20.0),
        ]
        df = _make_alias_stacked_df(rows)
        ts, channels, _ = _read_stacked_signal_file(df)

        assert set(channels.keys()) == {"ch_a", "ch_b"}
        assert ts == pytest.approx([0.0, 60.0])
        assert channels["ch_a"] == [1.0, 2.0]
        assert channels["ch_b"] == [10.0, 20.0]

    def test_timestamps_start_at_zero_with_alias_df(self):
        rows = [
            ("2026-04-20 06:30:00", "sig", 5.0),
            ("2026-04-20 06:31:00", "sig", 6.0),
        ]
        df = _make_alias_stacked_df(rows)
        ts, _, _ = _read_stacked_signal_file(df)
        assert ts[0] == pytest.approx(0.0)
        assert ts[1] == pytest.approx(60.0)

    def test_extra_columns_ignored(self):
        """equipment and unit columns must not appear in the channel output."""
        rows = [("2026-01-01 00:00:00", "pressure", 0.48)]
        df = _make_alias_stacked_df(rows)
        _, channels, _ = _read_stacked_signal_file(df)
        assert list(channels.keys()) == ["pressure"]
        assert "equipment" not in channels
        assert "unit" not in channels

    def test_channel_filter_works_with_alias_df(self):
        rows = [
            ("2026-01-01 00:00:00", "ch_a", 1.0),
            ("2026-01-01 00:00:00", "ch_b", 2.0),
        ]
        df = _make_alias_stacked_df(rows)
        _, channels, _ = _read_stacked_signal_file(df, channel_filter=["ch_a"])
        assert list(channels.keys()) == ["ch_a"]


class TestReadSignalFileDispatcherAliases:
    """_read_signal_file dispatcher must route alias-column CSVs to stacked reader."""

    def test_dispatches_alias_csv_to_stacked_reader(self, tmp_path):
        csv_path = str(tmp_path / "alias_stacked.csv")
        _write_alias_stacked_csv(
            [
                ("2026-01-01T00:00:00.000Z", "HeadPressureZone1", 0.48),
                ("2026-01-01T00:00:01.000Z", "HeadPressureZone1", 0.49),
                ("2026-01-01T00:00:00.000Z", "HeadRotation", 1.5),
                ("2026-01-01T00:00:01.000Z", "HeadRotation", 1.6),
            ],
            csv_path,
        )
        ts, channels, _ = _read_signal_file(csv_path)
        assert set(channels.keys()) == {"HeadPressureZone1", "HeadRotation"}
        assert ts[0] == pytest.approx(0.0)

    def test_alias_csv_elapsed_seconds(self, tmp_path):
        csv_path = str(tmp_path / "alias_timing.csv")
        _write_alias_stacked_csv(
            [
                ("2026-04-10T05:29:21.000Z", "sig", 0.0),
                ("2026-04-10T05:29:22.000Z", "sig", 1.0),
                ("2026-04-10T05:29:23.000Z", "sig", 2.0),
            ],
            csv_path,
        )
        ts, _, _ = _read_signal_file(csv_path)
        assert ts == pytest.approx([0.0, 1.0, 2.0])


class TestColumnInspectorDetectFormatAliases:
    """detect_csv_format must classify alias-column files as stacked."""

    def test_detects_alias_csv_as_stacked(self, tmp_path):
        csv_path = str(tmp_path / "alias.csv")
        _write_alias_stacked_csv(
            [
                ("2026-01-01T00:00:00.000Z", "HeadPressureZone1", 0.48),
                ("2026-01-01T00:00:01.000Z", "HeadPressureZone1", 0.49),
                ("2026-01-01T00:00:00.000Z", "HeadRotation", 1.5),
            ],
            csv_path,
        )
        from app.application.signal.column_inspector import ColumnInspector

        fmt, names = ColumnInspector().detect_csv_format(csv_path)
        assert fmt == "stacked"
        assert sorted(names) == ["HeadPressureZone1", "HeadRotation"]

    def test_alias_csv_signal_names_sorted(self, tmp_path):
        csv_path = str(tmp_path / "alias_sorted.csv")
        _write_alias_stacked_csv(
            [
                ("2026-01-01T00:00:00.000Z", "ZChannel", 1.0),
                ("2026-01-01T00:00:00.000Z", "AChannel", 2.0),
            ],
            csv_path,
        )
        from app.application.signal.column_inspector import ColumnInspector

        _, names = ColumnInspector().detect_csv_format(csv_path)
        assert names == ["AChannel", "ZChannel"]
