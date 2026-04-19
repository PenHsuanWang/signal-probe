"""Largest Triangle Three Buckets (LTTB) downsampling algorithm.

Pure-Python + NumPy implementation. No framework imports (Domain Layer rule).
"""

import math

import numpy as np

LTTB_DEFAULT_THRESHOLD = 2000


def downsample(
    x: list[float],
    y: list[float],
    threshold: int = LTTB_DEFAULT_THRESHOLD,
) -> tuple[list[float], list[float]]:
    """Downsample (x, y) to at most `threshold` points using LTTB.

    Always preserves first and last points and maximises triangle area
    to retain visual shape and extremes.
    """
    n = len(x)
    if n <= threshold:
        return x, y

    indices = _lttb_indices(
        np.asarray(x, dtype=np.float64),
        np.asarray(y, dtype=np.float64),
        threshold,
    )
    xa = np.asarray(x, dtype=np.float64)
    ya = np.asarray(y, dtype=np.float64)
    return xa[indices].tolist(), ya[indices].tolist()


def downsample_with_states(
    x: list[float],
    y: list[float],
    states: list[str],
    threshold: int = LTTB_DEFAULT_THRESHOLD,
) -> tuple[list[float], list[float], list[str]]:
    """Downsample x, y, and the parallel states array together."""
    n = len(x)
    if n <= threshold:
        return x, y, states

    xa = np.asarray(x, dtype=np.float64)
    ya = np.asarray(y, dtype=np.float64)
    indices = _lttb_indices(xa, ya, threshold)
    return xa[indices].tolist(), ya[indices].tolist(), [states[i] for i in indices]


def _lttb_indices(xa: np.ndarray, ya: np.ndarray, threshold: int) -> np.ndarray:
    """Return the integer indices selected by LTTB."""
    n = len(xa)
    sampled = np.empty(threshold, dtype=np.intp)
    sampled[0] = 0
    sampled[-1] = n - 1

    every = (n - 2) / (threshold - 2)
    a = 0

    for i in range(threshold - 2):
        # Current bucket range
        range_start = int(math.floor(i * every)) + 1
        range_end = int(math.floor((i + 1) * every)) + 1

        # Next bucket average (point C)
        avg_start = range_end
        avg_end = min(int(math.floor((i + 2) * every)) + 1, n)
        if avg_end > avg_start:
            avg_x = float(np.mean(xa[avg_start:avg_end]))
            avg_y = float(np.mean(ya[avg_start:avg_end]))
        else:
            idx = min(avg_start, n - 1)
            avg_x, avg_y = float(xa[idx]), float(ya[idx])

        # Vectorised triangle area for all candidates in current bucket
        ax = xa[a]
        ay = ya[a]
        bx = xa[range_start:range_end]
        by = ya[range_start:range_end]
        areas = np.abs((ax - avg_x) * (by - ay) - (ax - bx) * (avg_y - ay))
        best = int(np.argmax(areas))

        a = range_start + best
        sampled[i + 1] = a

    return sampled
