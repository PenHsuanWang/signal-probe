"""RollingVarianceClassifier: tags each sample as IDLE, ACTIVE, or OOC.

Uses vectorised Polars rolling statistics. No framework imports (only polars
and numpy are allowed as pure-science libraries in the Domain Layer).
"""

import polars as pl

from app.domain.signal.enums import SignalState

# Default hyper-parameters (can be tuned per-signal in a future iteration)
WINDOW: int = 50
IDLE_VARIANCE_THRESHOLD: float = 0.005
OOC_Z_SCORE_THRESHOLD: float = 3.0


def classify(values: list[float]) -> list[str]:
    """Classify each value as IDLE, ACTIVE, or OOC.

    Args:
        values: Raw signal values in chronological order.

    Returns:
        List of state strings parallel to `values`.
    """
    df = (
        pl.DataFrame({"v": values})
        .with_columns(
            [
                pl.col("v").rolling_var(window_size=WINDOW, min_periods=1).alias("rv"),
                pl.col("v").rolling_mean(window_size=WINDOW, min_periods=1).alias("rm"),
                pl.col("v").rolling_std(window_size=WINDOW, min_periods=1).alias("rs"),
            ]
        )
        .with_columns(
            pl.when(pl.col("rv").fill_null(0.0) < IDLE_VARIANCE_THRESHOLD)
            .then(pl.lit(SignalState.IDLE.value))
            .when(
                (pl.col("v") - pl.col("rm").fill_null(pl.col("v"))).abs()
                / (pl.col("rs").fill_null(0.0) + 1e-9)
                > OOC_Z_SCORE_THRESHOLD
            )
            .then(pl.lit(SignalState.OOC.value))
            .otherwise(pl.lit(SignalState.ACTIVE.value))
            .alias("state")
        )
    )
    return df["state"].to_list()
