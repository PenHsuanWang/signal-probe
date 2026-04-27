"""Process pool executor for CPU-bound analysis tasks.

Why ``ProcessPoolExecutor`` (not ``ThreadPoolExecutor``):
  * FFT / spectrogram computation is CPU-bound (NumPy, SciPy).
  * Python threads share one GIL; only one thread runs Python bytecode at a
    time, so ``ThreadPoolExecutor`` provides no CPU parallelism for code that
    holds the GIL between NumPy calls.
  * ``ProcessPoolExecutor`` workers are independent OS processes, each with
    their own GIL, enabling true multi-core utilisation on a single machine.
  * Workers are pre-forked at startup so first-request latency stays low.

Three-level concurrency model
------------------------------
1. **Algorithm** – spectrogram engine pre-selects only the frames that survive
   downsampling and processes them as a single vectorised matrix, eliminating
   the Python for-loop entirely.
2. **Intra-worker threads** – ``scipy.fft.rfft(workers=-1)`` dispatches the
   FFT computation to a pocketfft thread pool *inside* the worker process,
   saturating all available CPU threads for large transform sizes (≥ 32 k
   samples per the SciPy docs).
3. **Inter-process** – ``asyncio.get_running_loop().run_in_executor(executor,
   fn, ...)`` dispatches each request to a worker process, keeping the asyncio
   event loop completely non-blocking and allowing N concurrent analyses in
   parallel (N = ``ANALYSIS_WORKERS``).

Configuration
-------------
Set ``ANALYSIS_WORKERS`` to override the default worker count.
Default: ``max(2, os.cpu_count())``.
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor

_executor: ProcessPoolExecutor | None = None
_WORKERS: int = int(
    os.environ.get("ANALYSIS_WORKERS", str(max(2, os.cpu_count() or 2)))
)


def start_executor() -> None:
    """Initialise the global ``ProcessPoolExecutor``.

    Should be called exactly once, inside the FastAPI lifespan startup handler.
    Submits a warm-up task to each worker so they import NumPy and SciPy
    eagerly — this prevents the first real request from paying import costs.
    """
    global _executor
    _executor = ProcessPoolExecutor(max_workers=_WORKERS)
    # Warm up: force each worker to import NumPy/SciPy before the first request.
    list(_executor.map(_warm_up, range(_WORKERS)))


def stop_executor() -> None:
    """Shut down the executor gracefully.

    Waits for any in-flight tasks to finish before returning.
    Should be called inside the FastAPI lifespan shutdown handler.
    """
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=True)
        _executor = None


def get_executor() -> ProcessPoolExecutor:
    """Return the running executor.

    Raises:
        RuntimeError: If ``start_executor()`` has not been called yet.
    """
    if _executor is None:
        raise RuntimeError(
            "ProcessPoolExecutor is not initialised. "
            "Ensure the FastAPI lifespan handler has run start_executor()."
        )
    return _executor


def worker_count() -> int:
    """Return the configured number of worker processes."""
    return _WORKERS


def _warm_up(_: int) -> None:
    """No-op run in each worker to trigger eager module imports."""
    import numpy  # noqa: F401
    import scipy.fft  # noqa: F401
    import scipy.signal  # noqa: F401
