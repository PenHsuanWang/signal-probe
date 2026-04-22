import { useCallback, useEffect, useReducer } from 'react';
import { getRawColumns, processSignal } from '../lib/api';
import type { ColumnDescriptor, RawColumnsResponse } from '../types/signal';

// ---------------------------------------------------------------------------
// State shape & reducer
// ---------------------------------------------------------------------------

interface ColumnConfigState {
  /** Async loading status for the initial column inspection call. */
  status: 'loading' | 'ready' | 'error' | 'submitting' | 'submitted';
  /** Column descriptors returned by the API. */
  columns: ColumnDescriptor[];
  /** User-selected time axis column name. */
  timeCol: string | null;
  /** User-selected signal channel column names. */
  sigCols: Set<string>;
  /** Error from the column inspection fetch. */
  fetchError: string | null;
  /** Error from the process submission. */
  submitError: string | null;
}

type Action =
  | { type: 'FETCH_SUCCESS'; payload: RawColumnsResponse }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'SET_TIME_COL'; payload: string }
  | { type: 'TOGGLE_SIG_COL'; payload: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_SUCCESS' }
  | { type: 'SUBMIT_ERROR'; payload: string };

function reducer(state: ColumnConfigState, action: Action): ColumnConfigState {
  switch (action.type) {
    case 'FETCH_SUCCESS': {
      const candidateTime = action.payload.columns.find((c) => c.is_candidate_time);
      const numericSigs = action.payload.columns
        .filter((c) => !c.is_candidate_time && isNumericDtype(c.dtype))
        .map((c) => c.name);
      return {
        ...state,
        status: 'ready',
        columns: action.payload.columns,
        timeCol: candidateTime?.name ?? null,
        sigCols: new Set(numericSigs),
        fetchError: null,
      };
    }
    case 'FETCH_ERROR':
      return { ...state, status: 'error', fetchError: action.payload };
    case 'SET_TIME_COL':
      return { ...state, timeCol: action.payload };
    case 'TOGGLE_SIG_COL': {
      const next = new Set(state.sigCols);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, sigCols: next };
    }
    case 'SUBMIT_START':
      return { ...state, status: 'submitting', submitError: null };
    case 'SUBMIT_SUCCESS':
      return { ...state, status: 'submitted' };
    case 'SUBMIT_ERROR':
      return { ...state, status: 'ready', submitError: action.payload };
    default:
      return state;
  }
}

const INITIAL_STATE: ColumnConfigState = {
  status: 'loading',
  columns: [],
  timeCol: null,
  sigCols: new Set(),
  fetchError: null,
  submitError: null,
};

// ---------------------------------------------------------------------------
// Pure helper (hoisted outside the hook — no closure needed)
// ---------------------------------------------------------------------------

export function isNumericDtype(dtype: string): boolean {
  // Backend returns the mapped type "numeric"; also accept raw Polars-style prefixes
  // (int*, uint*, float*) for forward compatibility.
  return dtype === 'numeric' || /^(int|uint|float)/i.test(dtype);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseColumnConfigReturn {
  /** Current async status. */
  status: ColumnConfigState['status'];
  /** Inspected columns. Empty until status is 'ready'. */
  columns: ColumnDescriptor[];
  /** Currently selected time axis column. */
  timeCol: string | null;
  /** Currently selected signal channel columns. */
  sigCols: Set<string>;
  /** Error message from initial column fetch, if any. */
  fetchError: string | null;
  /** Error message from process submission, if any. */
  submitError: string | null;
  /** Whether the form is ready to submit (time col + at least one sig col, no overlap). */
  canSubmit: boolean;
  /** Select the time axis column. */
  setTimeCol: (name: string) => void;
  /** Toggle a signal column on/off. */
  toggleSigCol: (name: string) => void;
  /** Submit the column config and trigger the backend pipeline. */
  handleSubmit: () => Promise<void>;
}

/**
 * useColumnConfig — manages column inspection and configuration form state
 * for a signal that is in AWAITING_CONFIG status.
 *
 * Calls GET /signals/{signalId}/raw-columns on mount, then provides
 * controlled state + a submit handler for POST /signals/{signalId}/process.
 *
 * @param signalId - The signal UUID to configure.
 * @param onConfigured - Called after the process request succeeds.
 */
export function useColumnConfig(
  signalId: string,
  onConfigured: () => void,
): UseColumnConfigReturn {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Fetch column descriptors on mount (or when signalId changes).
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'FETCH_SUCCESS', payload: { signal_id: signalId, columns: [] } }); // reset to loading
    getRawColumns(signalId)
      .then((data) => {
        if (!cancelled) dispatch({ type: 'FETCH_SUCCESS', payload: data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            'Failed to load columns';
          dispatch({ type: 'FETCH_ERROR', payload: detail });
        }
      });
    return () => { cancelled = true; };
  }, [signalId]);

  const setTimeCol = useCallback((name: string) => {
    dispatch({ type: 'SET_TIME_COL', payload: name });
  }, []);

  const toggleSigCol = useCallback((name: string) => {
    dispatch({ type: 'TOGGLE_SIG_COL', payload: name });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!state.timeCol || state.sigCols.size === 0) return;
    dispatch({ type: 'SUBMIT_START' });
    try {
      await processSignal(signalId, {
        time_column: state.timeCol,
        signal_columns: Array.from(state.sigCols),
      });
      dispatch({ type: 'SUBMIT_SUCCESS' });
      onConfigured();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to start processing';
      dispatch({ type: 'SUBMIT_ERROR', payload: detail });
    }
  }, [signalId, state.timeCol, state.sigCols, onConfigured]);

  const canSubmit =
    !!state.timeCol &&
    state.sigCols.size > 0 &&
    !state.sigCols.has(state.timeCol) &&
    state.status === 'ready';

  return {
    status: state.status,
    columns: state.columns,
    timeCol: state.timeCol,
    sigCols: state.sigCols,
    fetchError: state.fetchError,
    submitError: state.submitError,
    canSubmit,
    setTimeCol,
    toggleSigCol,
    handleSubmit,
  };
}
