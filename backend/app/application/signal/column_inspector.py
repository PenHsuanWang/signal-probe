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
