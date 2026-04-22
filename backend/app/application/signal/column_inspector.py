"""ColumnInspector: lightweight raw-file introspection for the column-config step.

Reads only the first 100 rows of a raw CSV or Parquet file to produce a list of
:class:`ColumnDescriptor` value objects.  Never triggers the full pipeline.

Design notes (ADR-006)
----------------------
This class lives in the Application Layer — not the Domain Layer — because it
imports Polars, violating the Domain Layer's zero-framework-imports invariant.
"""

from __future__ import annotations

import os
import re

import polars as pl

from app.domain.signal.schemas import ColumnDescriptor

# Maximum rows sampled for type inference and sample-value extraction.
_SAMPLE_ROWS = 100
# Maximum sample values returned per column.
_MAX_SAMPLES = 3

# Column names that strongly suggest a time axis (case-insensitive word boundary match).
_TIME_NAME_RE = re.compile(
    r"\b(time|timestamp|ts|datetime|date|epoch|t)\b", re.IGNORECASE
)

# Required columns (lower-cased) that identify a long/stacked-format CSV.
_STACKED_REQUIRED_COLS = frozenset({"datetime", "signal_name", "signal_value"})


class ColumnInspector:
    """Inspect raw CSV / Parquet column metadata without full pipeline execution."""

    def inspect_columns(self, raw_path: str) -> list[ColumnDescriptor]:
        """Return a :class:`ColumnDescriptor` for every column in *raw_path*.

        Args:
            raw_path: Absolute path to the raw uploaded file (.csv or .parquet).

        Returns:
            Ordered list of column descriptors matching the file's column order.

        Raises:
            ValueError: If the file cannot be read or contains no columns.
        """
        df = self._load_sample(raw_path)
        if df.is_empty() and len(df.columns) == 0:
            raise ValueError("File contains no columns.")
        return [self._describe_column(df, col) for col in df.columns]

    def detect_csv_format(self, raw_path: str) -> tuple[str, list[str]]:
        """Detect whether the file is wide or stacked format.

        For stacked format, also returns all unique signal names found in the
        ``signal_name`` column by reading only that column from the full file
        (efficient even for large files).

        Args:
            raw_path: Absolute path to the raw uploaded file.

        Returns:
            A ``(csv_format, stacked_signal_names)`` tuple where *csv_format* is
            either ``"wide"`` or ``"stacked"``, and *stacked_signal_names* is a
            sorted list of unique signal names (empty for wide format).
        """
        # Read just the header row to check column names cheaply.
        ext = os.path.splitext(raw_path)[1].lower()
        if ext in (".parquet", ".pq"):
            header_df = pl.read_parquet(raw_path).head(1)
        else:
            header_df = pl.read_csv(
                raw_path, n_rows=1, infer_schema_length=1, ignore_errors=True
            )

        lower_cols = {c.lower() for c in header_df.columns}
        if not _STACKED_REQUIRED_COLS.issubset(lower_cols):
            return "wide", []

        # Stacked format detected — find the actual column name for signal_name.
        signal_name_col = next(
            c for c in header_df.columns if c.lower() == "signal_name"
        )

        # Read only the signal_name column to enumerate all unique channel names.
        if ext in (".parquet", ".pq"):
            names_df = pl.read_parquet(raw_path, columns=[signal_name_col])
        else:
            names_df = pl.read_csv(
                raw_path,
                columns=[signal_name_col],
                infer_schema_length=500,
                ignore_errors=True,
            )

        signal_names: list[str] = sorted(
            # Cast to str defensively: signal_name values should always be strings
            # but a CSV with a numeric-looking column may be inferred as int/float.
            str(v)
            for v in names_df[signal_name_col].drop_nulls().unique().to_list()
        )
        return "stacked", signal_names

    # ── Private helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _load_sample(raw_path: str) -> pl.DataFrame:
        """Load the first *_SAMPLE_ROWS* rows without schema coercion."""
        ext = os.path.splitext(raw_path)[1].lower()
        if ext in (".parquet", ".pq"):
            # Parquet has no row-count shortcut; slice after read for small files.
            return pl.read_parquet(raw_path).head(_SAMPLE_ROWS)
        return pl.read_csv(
            raw_path,
            n_rows=_SAMPLE_ROWS,
            infer_schema_length=_SAMPLE_ROWS,
            try_parse_dates=True,
            ignore_errors=True,
        )

    @staticmethod
    def _polars_to_dtype(pl_dtype: pl.DataType) -> str:
        """Map a Polars dtype to the four-value discriminator used by the API."""
        if pl_dtype.is_temporal():
            return "temporal"
        if pl_dtype == pl.Boolean:
            return "boolean"
        if pl_dtype.is_numeric():
            return "numeric"
        return "string"

    def _describe_column(self, df: pl.DataFrame, col: str) -> ColumnDescriptor:
        series = df[col]
        dtype_str = self._polars_to_dtype(series.dtype)

        # Sample up to _MAX_SAMPLES non-null values (cast to string for JSON safety).
        non_null = series.drop_nulls()
        samples = [str(v) for v in non_null.head(_MAX_SAMPLES).to_list()]

        null_count = series.null_count()

        is_candidate = dtype_str == "temporal" or (
            dtype_str == "numeric" and bool(_TIME_NAME_RE.search(col))
        )

        return ColumnDescriptor(
            name=col,
            dtype=dtype_str,
            sample_values=samples,
            null_count=null_count,
            is_candidate_time=is_candidate,
        )
