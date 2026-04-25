"""RollingVarianceClassifier: tags each sample as IDLE or ACTIVE.

Uses vectorised Polars rolling statistics. No framework imports (only polars
and numpy are allowed as pure-science libraries in the Domain Layer).
"""

import polars as pl

from app.domain.signal.enums import SignalState

# Default hyper-parameters (can be tuned per-signal in a future iteration)
WINDOW: int = 50
IDLE_VARIANCE_THRESHOLD: float = 0.005


def classify(values: list[float | None]) -> list[str]:
    """Classify each value as IDLE or ACTIVE.

    Args:
        values: Raw signal values in chronological order.  ``None`` entries
                (produced by time-alignment of stacked CSVs) are treated as
                missing data and classified as ``IDLE`` because their rolling
                variance is effectively zero.

    Returns:
        List of state strings parallel to ``values``.
    """
    df = (
        pl.DataFrame({"v": values})
        .with_columns(
            pl.col("v").rolling_var(window_size=WINDOW, min_samples=1).alias("rv"),
        )
        .with_columns(
            pl.when(pl.col("rv").fill_null(0.0) < IDLE_VARIANCE_THRESHOLD)
            .then(pl.lit(SignalState.IDLE.value))
            .otherwise(pl.lit(SignalState.ACTIVE.value))
            .alias("state")
        )
    )
    return df["state"].to_list()
