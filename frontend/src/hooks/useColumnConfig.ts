import { useCallback, useEffect, useReducer } from 'react';
import { getRawColumns, processSignal } from '../lib/api';
import type { ColumnDescriptor, RawColumnsResponse } from '../types/signal';

// ---------------------------------------------------------------------------
// State shape & reducer
// ---------------------------------------------------------------------------

interface ColumnConfigState {
  /** Async loading status for the initial column inspection call. */
  status: 'loading' | 'ready' | 'error' | 'submitting' | 'submitted';
  /** Detected CSV format. */
  csvFormat: 'wide' | 'stacked';
  /** Column descriptors returned by the API. */
  columns: ColumnDescriptor[];
  /** Available signal names (stacked format only). */
  stackedSignalNames: string[];
  /** User-selected signal names to include (stacked format). */
  selectedStackedChannels: Set<string>;
  /** User-selected time axis column name (wide format). */
  timeCol: string | null;
  /** User-selected signal channel column names (wide format). */
  sigCols: Set<string>;
  /** Error from the column inspection fetch. */
  fetchError: string | null;
  /** Error from the process submission. */
  submitError: string | null;
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: RawColumnsResponse }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'SET_TIME_COL'; payload: string }
  | { type: 'TOGGLE_SIG_COL'; payload: string }
  | { type: 'TOGGLE_STACKED_CHANNEL'; payload: string }
  | { type: 'SELECT_ALL_STACKED_CHANNELS' }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_SUCCESS' }
  | { type: 'SUBMIT_ERROR'; payload: string };

function reducer(state: ColumnConfigState, action: Action): ColumnConfigState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...INITIAL_STATE };
    case 'FETCH_SUCCESS': {
      const { csv_format, stacked_signal_names, columns } = action.payload;
      if (csv_format === 'stacked') {
        // Auto-select all stacked channels by default.
        return {
          ...state,
          status: 'ready',
          csvFormat: 'stacked',
          columns,
          stackedSignalNames: stacked_signal_names,
          selectedStackedChannels: new Set(stacked_signal_names),
          timeCol: null,
          sigCols: new Set(),
          fetchError: null,
        };
      }
      // Wide format — keep existing auto-selection logic.
      const candidateTime = columns.find((c) => c.is_candidate_time);
      const numericSigs = columns
        .filter((c) => !c.is_candidate_time && isNumericDtype(c.dtype))
        .map((c) => c.name);
      return {
        ...state,
        status: 'ready',
        csvFormat: 'wide',
        columns,
        stackedSignalNames: [],
        selectedStackedChannels: new Set(),
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
    case 'TOGGLE_STACKED_CHANNEL': {
      const next = new Set(state.selectedStackedChannels);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, selectedStackedChannels: next };
    }
    case 'SELECT_ALL_STACKED_CHANNELS':
      return {
        ...state,
        selectedStackedChannels: new Set(state.stackedSignalNames),
      };
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
  csvFormat: 'wide',
  columns: [],
  stackedSignalNames: [],
  selectedStackedChannels: new Set(),
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
  /** Detected CSV format. */
  csvFormat: 'wide' | 'stacked';
  /** Inspected columns. Empty until status is 'ready'. */
  columns: ColumnDescriptor[];
  /** Available signal names (stacked format only). */
  stackedSignalNames: string[];
  /** Currently selected stacked channel names. */
  selectedStackedChannels: Set<string>;
  /** Currently selected time axis column (wide format). */
  timeCol: string | null;
  /** Currently selected signal channel columns (wide format). */
  sigCols: Set<string>;
  /** Error message from initial column fetch, if any. */
  fetchError: string | null;
  /** Error message from process submission, if any. */
  submitError: string | null;
  /** Whether the form is ready to submit. */
  canSubmit: boolean;
  /** Select the time axis column (wide format). */
  setTimeCol: (name: string) => void;
  /** Toggle a signal column on/off (wide format). */
  toggleSigCol: (name: string) => void;
  /** Toggle a stacked channel on/off (stacked format). */
  toggleStackedChannel: (name: string) => void;
  /** Select all available stacked channels. */
  selectAllStackedChannels: () => void;
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
 * Supports both wide format (user picks time column + signal columns) and
 * stacked/long format (user selects which channels from signal_name to include).
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
    dispatch({ type: 'FETCH_START' });
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

  const toggleStackedChannel = useCallback((name: string) => {
    dispatch({ type: 'TOGGLE_STACKED_CHANNEL', payload: name });
  }, []);

  const selectAllStackedChannels = useCallback(() => {
    dispatch({ type: 'SELECT_ALL_STACKED_CHANNELS' });
  }, []);

  const handleSubmit = useCallback(async () => {
    dispatch({ type: 'SUBMIT_START' });
    try {
      if (state.csvFormat === 'stacked') {
        const filter = state.selectedStackedChannels.size < state.stackedSignalNames.length
          ? Array.from(state.selectedStackedChannels)
          : null; // null = include all
        await processSignal(signalId, {
          csv_format: 'stacked',
          stacked_channel_filter: filter,
        });
      } else {
        if (!state.timeCol || state.sigCols.size === 0) {
          dispatch({ type: 'SUBMIT_ERROR', payload: 'Select a time column and at least one signal channel.' });
          return;
        }
        await processSignal(signalId, {
          csv_format: 'wide',
          time_column: state.timeCol,
          signal_columns: Array.from(state.sigCols),
        });
      }
      dispatch({ type: 'SUBMIT_SUCCESS' });
      onConfigured();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to start processing';
      dispatch({ type: 'SUBMIT_ERROR', payload: detail });
    }
  }, [signalId, state.csvFormat, state.timeCol, state.sigCols, state.selectedStackedChannels, state.stackedSignalNames, onConfigured]);

  const canSubmit =
    state.status === 'ready' &&
    (state.csvFormat === 'stacked'
      ? state.selectedStackedChannels.size > 0
      : !!state.timeCol &&
        state.sigCols.size > 0 &&
        !state.sigCols.has(state.timeCol));

  return {
    status: state.status,
    csvFormat: state.csvFormat,
    columns: state.columns,
    stackedSignalNames: state.stackedSignalNames,
    selectedStackedChannels: state.selectedStackedChannels,
    timeCol: state.timeCol,
    sigCols: state.sigCols,
    fetchError: state.fetchError,
    submitError: state.submitError,
    canSubmit,
    setTimeCol,
    toggleSigCol,
    toggleStackedChannel,
    selectAllStackedChannels,
    handleSubmit,
  };
}
