"""Shared constants for stacked (long) CSV format detection and normalisation.

Both the pipeline reader and the column inspector must agree on which column
names constitute a stacked-format file.  Defining the constants here — the
Domain layer — ensures a single source of truth and prevents silent divergence
between format detection and processing.
"""

# Canonical lower-cased column names that identify a long/stacked-format file.
STACKED_REQUIRED_COLS: frozenset[str] = frozenset(
    {"datetime", "signal_name", "signal_value"}
)

# Maps lower-cased non-standard column names → canonical stacked-format names.
# Extend this dict whenever a new vendor variant is encountered.
STACKED_COL_ALIASES: dict[str, str] = {
    "measurement_datetime": "datetime",
    "measurement_value": "signal_value",
}
