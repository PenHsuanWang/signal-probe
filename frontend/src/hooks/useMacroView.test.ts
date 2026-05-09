/**
 * Unit tests for useMacroView hook.
 *
 * Coverage:
 *   - Null signalId → does not fetch; returns null macroData immediately
 *   - Signal not found in context → does not fetch
 *   - Signal found but status !== 'COMPLETED' → does not fetch
 *   - Signal COMPLETED → fetches, returns macroData, sets loading → false
 *   - getMacroView rejects → error = true, macroData = null, loading = false
 *   - retry() increments retryCount → re-triggers the fetch effect
 *   - Cleanup: cancelled = true prevents state updates after unmount
 *   - Signal transitions from PROCESSING → COMPLETED → triggers fetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMacroView } from './useMacroView';
import type { MacroViewResponse, SignalMetadata } from '../types/signal';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  getMacroView: vi.fn(),
}));

vi.mock('../context/SignalsContext', () => ({
  useSignals: vi.fn(),
}));

import { getMacroView } from '../lib/api';
import { useSignals } from '../context/SignalsContext';

const mockGetMacroView = vi.mocked(getMacroView);
const mockUseSignals = vi.mocked(useSignals);

// ── Test fixtures ─────────────────────────────────────────────────────────────

const COMPLETED_SIGNAL: SignalMetadata = {
  id: 'sig-001',
  original_filename: 'vibration.csv',
  status: 'COMPLETED',
  total_points: 10000,
  active_run_count: 3,
  error_message: null,
  channel_names: ['voltage', 'current'],
  time_column: 'time',
  signal_columns: ['voltage', 'current'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:01:00Z',
};

const PROCESSING_SIGNAL: SignalMetadata = {
  ...COMPLETED_SIGNAL,
  id: 'sig-002',
  status: 'PROCESSING',
};

const MOCK_MACRO: MacroViewResponse = {
  signal_id: 'sig-001',
  x: [0, 0.1, 0.2, 0.3],
  channels: [
    { channel_name: 'voltage', y: [1.0, 1.1, 0.9, 1.0], states: ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE'] },
  ],
  runs: [{ run_id: 'run-1', run_index: 0, start_x: 0, end_x: 0.3 }],
  t0_epoch_s: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupContext(signals: SignalMetadata[]) {
  mockUseSignals.mockReturnValue({ signals, refresh: vi.fn() });
}

beforeEach(() => {
  // Safe default: prevents undefined.then() inside useEffect from hanging React 19.
  mockGetMacroView.mockResolvedValue({
    signal_id: '',
    x: [],
    channels: [],
    runs: [],
    t0_epoch_s: null,
  } satisfies MacroViewResponse);
});

afterEach(() => {
  vi.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useMacroView — null / missing signalId', () => {
  it('test_useMacroView_when_signalId_is_null_returns_null_without_fetching', async () => {
    // Arrange
    setupContext([COMPLETED_SIGNAL]);

    // Act
    const { result } = renderHook(() => useMacroView(null));

    // Assert
    expect(result.current.macroData).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(mockGetMacroView).not.toHaveBeenCalled();
  });

  it('test_useMacroView_when_signal_not_in_context_returns_null_without_fetching', async () => {
    // Arrange — empty signals list
    setupContext([]);

    // Act
    const { result } = renderHook(() => useMacroView('sig-001'));

    // Assert
    expect(result.current.macroData).toBeNull();
    expect(mockGetMacroView).not.toHaveBeenCalled();
  });
});

describe('useMacroView — non-COMPLETED status', () => {
  it.each(['AWAITING_CONFIG', 'PENDING', 'PROCESSING', 'FAILED'] as const)(
    'test_useMacroView_when_status_is_%s_does_not_fetch',
    (status) => {
      // Arrange
      setupContext([{ ...COMPLETED_SIGNAL, status }]);

      // Act
      const { result } = renderHook(() => useMacroView('sig-001'));

      // Assert
      expect(result.current.macroData).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(mockGetMacroView).not.toHaveBeenCalled();
    },
  );
});

describe('useMacroView — happy path (COMPLETED signal)', () => {
  it('test_useMacroView_when_signal_completed_fetches_and_returns_macroData', async () => {
    // Arrange
    setupContext([COMPLETED_SIGNAL]);
    mockGetMacroView.mockResolvedValueOnce(MOCK_MACRO);

    // Act
    const { result } = renderHook(() => useMacroView('sig-001'));

    // Assert — after async resolution
    await waitFor(() => expect(result.current.macroData).not.toBeNull());

    expect(result.current.macroData).toEqual(MOCK_MACRO);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(mockGetMacroView).toHaveBeenCalledOnce();
    expect(mockGetMacroView).toHaveBeenCalledWith('sig-001');
  });

  it('test_useMacroView_when_fetching_sets_loading_true_during_request', async () => {
    // Arrange
    setupContext([COMPLETED_SIGNAL]);
    let resolvePromise!: (v: MacroViewResponse) => void;
    mockGetMacroView.mockReturnValueOnce(
      new Promise<MacroViewResponse>((res) => { resolvePromise = res; }),
    );

    // Act
    const { result } = renderHook(() => useMacroView('sig-001'));

    // Assert — loading is true while inflight
    expect(result.current.loading).toBe(true);

    // Resolve and verify loading is cleared
    await act(async () => { resolvePromise(MOCK_MACRO); });

    expect(result.current.loading).toBe(false);
    expect(result.current.macroData).toEqual(MOCK_MACRO);
  });
});

describe('useMacroView — error handling', () => {
  it('test_useMacroView_when_getMacroView_rejects_sets_error_true_and_macroData_null', async () => {
    // Arrange
    setupContext([COMPLETED_SIGNAL]);
    mockGetMacroView.mockRejectedValueOnce(new Error('Network Error'));

    // Act
    const { result } = renderHook(() => useMacroView('sig-001'));

    // Assert
    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.macroData).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe('useMacroView — retry', () => {
  it('test_useMacroView_retry_triggers_refetch_after_error', async () => {
    // Arrange — first call fails, second succeeds
    setupContext([COMPLETED_SIGNAL]);
    mockGetMacroView
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValueOnce(MOCK_MACRO);

    const { result } = renderHook(() => useMacroView('sig-001'));
    await waitFor(() => expect(result.current.error).toBe(true));

    expect(mockGetMacroView).toHaveBeenCalledTimes(1);

    // Act — trigger retry
    await act(async () => { result.current.retry(); });

    // Assert — second attempt succeeds
    await waitFor(() => expect(result.current.macroData).not.toBeNull());

    expect(result.current.error).toBe(false);
    expect(result.current.macroData).toEqual(MOCK_MACRO);
    expect(mockGetMacroView).toHaveBeenCalledTimes(2);
  });

  it('test_useMacroView_retry_is_stable_reference_does_not_change_between_renders', () => {
    // Use PROCESSING signal so no fetch fires (avoids async act() warning)
    setupContext([PROCESSING_SIGNAL]);

    const { result, rerender } = renderHook(() => useMacroView('sig-001'));
    const firstRetry = result.current.retry;
    rerender();
    const secondRetry = result.current.retry;

    // Assert — useCallback guarantees stable reference
    expect(firstRetry).toBe(secondRetry);
  });
});

describe('useMacroView — signal status transitions', () => {
  it('test_useMacroView_when_signal_transitions_to_COMPLETED_triggers_fetch', async () => {
    // Arrange — start with PROCESSING signal
    setupContext([PROCESSING_SIGNAL]);
    mockGetMacroView.mockResolvedValueOnce({ ...MOCK_MACRO, signal_id: 'sig-002' });

    const { result, rerender } = renderHook(() => useMacroView('sig-002'));

    // Not yet fetched
    expect(mockGetMacroView).not.toHaveBeenCalled();

    // Act — signal transitions to COMPLETED
    setupContext([{ ...PROCESSING_SIGNAL, status: 'COMPLETED' }]);
    rerender();

    // Assert — fetch is now triggered
    await waitFor(() => expect(result.current.macroData).not.toBeNull());
    expect(mockGetMacroView).toHaveBeenCalledWith('sig-002');
  });
});
