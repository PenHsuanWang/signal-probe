/**
 * Unit tests for useRunChunks hook.
 *
 * Coverage:
 *   - Null signalId → returns empty array; no API call
 *   - Null xRange → returns empty array; no API call
 *   - Null macroData → returns empty array; no API call
 *   - macroData with no runs → returns empty array; no API call
 *   - xRange covers no runs (all outside window) → returns empty; no API call
 *   - Partially intersecting run IS included (start_x < x1 AND end_x > x0)
 *   - Only runs that intersect xRange are passed to getRunChunks
 *   - getRunChunks rejects → error = true, runChunks = []
 *   - Loading state is set true during fetch and cleared after
 *   - Changing xRange aborts the previous request and re-fetches
 *   - Intersection edge cases: adjacent (not overlapping) runs are excluded
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRunChunks } from './useRunChunks';
import type { MacroViewResponse, RunChunkResponse } from '../types/signal';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  getRunChunks: vi.fn(),
}));

import { getRunChunks } from '../lib/api';

const mockGetRunChunks = vi.mocked(getRunChunks);

// ── Test fixtures ─────────────────────────────────────────────────────────────

const MOCK_MACRO: MacroViewResponse = {
  signal_id: 'sig-001',
  x: [0, 1, 2, 3, 4, 5],
  channels: [
    { channel_name: 'voltage', y: [1, 2, 3, 4, 5, 6], states: ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE'] },
  ],
  runs: [
    { run_id: 'run-A', run_index: 0, start_x: 0.0, end_x: 1.5 },
    { run_id: 'run-B', run_index: 1, start_x: 2.0, end_x: 3.5 },
    { run_id: 'run-C', run_index: 2, start_x: 4.0, end_x: 5.5 },
  ],
  t0_epoch_s: null,
};

const MACRO_NO_RUNS: MacroViewResponse = {
  ...MOCK_MACRO,
  runs: [],
};

const MOCK_CHUNKS: RunChunkResponse[] = [
  {
    run_id: 'run-A',
    run_index: 0,
    duration_seconds: 1.5,
    value_max: 2.0,
    value_min: 1.0,
    value_mean: 1.5,
    value_variance: 0.25,
    x: [0, 0.5, 1.0, 1.5],
    channels: [{ channel_name: 'voltage', y: [1.0, 1.5, 2.0, 1.8], states: ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE'] }],
  },
];

beforeEach(() => {
  // Always return a resolved promise as safe default.
  // Without this, vi.fn() returns `undefined`, and undefined.then() throws
  // synchronously inside useEffect, causing React 19 to hang in test environments.
  mockGetRunChunks.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks(); // clears both call state and mock implementations
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useRunChunks — null / missing inputs', () => {
  it('test_useRunChunks_when_signalId_is_null_returns_empty_without_fetching', () => {
    const xRange: [number, number] = [0, 2];
    const { result } = renderHook(() =>
      useRunChunks(null, xRange, MOCK_MACRO),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });

  it('test_useRunChunks_when_xRange_is_null_returns_empty_without_fetching', () => {
    const { result } = renderHook(() =>
      useRunChunks('sig-001', null, MOCK_MACRO),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });

  it('test_useRunChunks_when_macroData_is_null_returns_empty_without_fetching', () => {
    const xRange: [number, number] = [0, 2];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, null),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });
});

describe('useRunChunks — run intersection logic (no API call)', () => {
  it('test_useRunChunks_when_macroData_has_no_runs_returns_empty_without_fetching', () => {
    const xRange: [number, number] = [0, 5];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, MACRO_NO_RUNS),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });

  it('test_useRunChunks_when_xRange_does_not_overlap_any_run_returns_empty_without_fetching', () => {
    // xRange [6, 10] is entirely after all runs (which end at 5.5)
    const xRange: [number, number] = [6.0, 10.0];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, MOCK_MACRO),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });

  it('test_useRunChunks_when_run_ends_exactly_at_x0_is_excluded_as_non_intersecting', () => {
    // run-A: start_x=0, end_x=1.5; xRange x0=1.5
    // condition: end_x > x0 → 1.5 > 1.5 is FALSE → run-A excluded
    const singleRunMacro: MacroViewResponse = {
      ...MOCK_MACRO,
      runs: [{ run_id: 'run-A', run_index: 0, start_x: 0.0, end_x: 1.5 }],
    };
    const xRange: [number, number] = [1.5, 5.0];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, singleRunMacro),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });

  it('test_useRunChunks_when_run_starts_exactly_at_x1_is_excluded_as_non_intersecting', () => {
    // run-B: start_x=2.0; xRange x1=2.0
    // condition: start_x < x1 → 2.0 < 2.0 is FALSE → run-B excluded
    const singleRunMacro: MacroViewResponse = {
      ...MOCK_MACRO,
      runs: [{ run_id: 'run-B', run_index: 1, start_x: 2.0, end_x: 3.5 }],
    };
    const xRange: [number, number] = [0.0, 2.0];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, singleRunMacro),
    );

    expect(result.current.runChunks).toEqual([]);
    expect(mockGetRunChunks).not.toHaveBeenCalled();
  });
});

describe('useRunChunks — happy path', () => {
  it('test_useRunChunks_when_xRange_intersects_runs_calls_getRunChunks_with_correct_ids', async () => {
    // xRange [0, 2.5] covers run-A (0–1.5) and run-B (2.0–3.5)
    mockGetRunChunks.mockResolvedValueOnce(MOCK_CHUNKS);
    const xRange: [number, number] = [0.0, 2.5];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, MOCK_MACRO),
    );

    await waitFor(() => expect(result.current.runChunks).toHaveLength(1));

    expect(mockGetRunChunks).toHaveBeenCalledOnce();
    expect(mockGetRunChunks).toHaveBeenCalledWith(
      'sig-001',
      expect.arrayContaining(['run-A', 'run-B']),
    );
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('test_useRunChunks_when_only_one_run_intersects_fetches_only_that_run', async () => {
    // xRange [4.5, 6] covers only run-C (4.0–5.5)
    mockGetRunChunks.mockResolvedValueOnce([]);
    const xRange: [number, number] = [4.5, 6.0];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, MOCK_MACRO),
    );

    await waitFor(() => expect(mockGetRunChunks).toHaveBeenCalledOnce());
    expect(mockGetRunChunks).toHaveBeenCalledWith('sig-001', ['run-C']);
    expect(result.current.error).toBe(false);
  });

  it('test_useRunChunks_when_fetching_sets_loading_true_during_request', async () => {
    let resolveChunks!: (v: RunChunkResponse[]) => void;
    mockGetRunChunks.mockReturnValueOnce(
      new Promise<RunChunkResponse[]>((res) => { resolveChunks = res; }),
    );
    const xRange: [number, number] = [0, 2];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, MOCK_MACRO),
    );

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => { resolveChunks(MOCK_CHUNKS); });

    expect(result.current.loading).toBe(false);
    expect(result.current.runChunks).toEqual(MOCK_CHUNKS);
  });
});

describe('useRunChunks — error handling', () => {
  it('test_useRunChunks_when_getRunChunks_rejects_sets_error_true_and_clears_chunks', async () => {
    mockGetRunChunks.mockRejectedValueOnce(new Error('500 Internal Server Error'));
    const xRange: [number, number] = [0, 2];
    const { result } = renderHook(() =>
      useRunChunks('sig-001', xRange, MOCK_MACRO),
    );

    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.runChunks).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

describe('useRunChunks — xRange change re-fetches', () => {
  it('test_useRunChunks_when_xRange_changes_fetches_with_new_window', async () => {
    const xRange1: [number, number] = [0.0, 2.0];
    const xRange2: [number, number] = [4.5, 6.0];

    const { rerender } = renderHook(
      ({ xRange }: { xRange: [number, number] }) =>
        useRunChunks('sig-001', xRange, MOCK_MACRO),
      { initialProps: { xRange: xRange1 } },
    );

    await waitFor(() => expect(mockGetRunChunks).toHaveBeenCalledTimes(1));
    // [0, 2) covers only run-A (start_x=0, end_x=1.5)
    expect(mockGetRunChunks).toHaveBeenCalledWith('sig-001', ['run-A']);

    rerender({ xRange: xRange2 });

    await waitFor(() => expect(mockGetRunChunks).toHaveBeenCalledTimes(2));
    expect(mockGetRunChunks).toHaveBeenLastCalledWith('sig-001', ['run-C']);
  });
});
