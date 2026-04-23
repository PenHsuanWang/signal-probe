"""ActiveRunSegmenter: groups consecutive ACTIVE samples into Run objects.

Pure Python + NumPy. No framework imports (Domain Layer rule).
"""

from dataclasses import dataclass

import numpy as np

from app.domain.signal.enums import SignalState

# Minimum run length in samples to be kept (filters 1-sample noise bursts)
MIN_RUN_SAMPLES: int = 3


@dataclass
class RawRun:
    run_index: int
    start_x: float
    end_x: float
    duration_seconds: float
    value_max: float
    value_min: float
    value_mean: float
    value_variance: float
    x: list[float]
    y: list[float]
    states: list[str]


def segment(
    timestamps: list[float],
    values: list[float],
    states: list[str],
) -> list[RawRun]:
    """Return a list of RawRun objects for every continuous ACTIVE block."""
    active_states = {SignalState.ACTIVE.value}
    n = len(timestamps)
    runs: list[RawRun] = []
    run_index = 0
    i = 0

    while i < n:
        if states[i] in active_states:
            start_i = i
            while i < n and states[i] in active_states:
                i += 1
            end_i = i - 1

            if (end_i - start_i + 1) < MIN_RUN_SAMPLES:
                continue

            rx = timestamps[start_i : end_i + 1]
            ry = values[start_i : end_i + 1]
            rs = states[start_i : end_i + 1]
            arr = np.asarray(ry, dtype=np.float64)

            runs.append(
                RawRun(
                    run_index=run_index,
                    start_x=rx[0],
                    end_x=rx[-1],
                    duration_seconds=rx[-1] - rx[0],
                    value_max=float(np.max(arr)),
                    value_min=float(np.min(arr)),
                    value_mean=float(np.mean(arr)),
                    value_variance=float(np.var(arr)),
                    x=rx,
                    y=ry,
                    states=rs,
                )
            )
            run_index += 1
        else:
            i += 1

    return runs
