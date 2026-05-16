import { useReducer, useCallback, useRef, useMemo, useEffect } from 'react';
import axios from 'axios';
import type { AxiosError } from 'axios';
import { fetchSTFT, fetchSpectrogram } from '../lib/api';
import type {
  WindowFunction,
  STFTResponse,
  SpectrogramResponse,
  ExplorationWindow,
  ExplorationPhase,
} from '../types/signal';

// ── Utility ───────────────────────────────────────────────────────────────────

/** Returns the smallest power of two >= n, capped at 131072. */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 4;
  let p = 1;
  while (p < n) p <<= 1;
  return Math.min(p, 131072);
}

/**
 * Returns the largest power of two <= n, with a minimum of 4.
 * Used for spectrogram window size so the window always fits within
 * the available sample count (prevents 422 "too few samples" errors).
 */
export function prevPowerOfTwo(n: number): number {
  if (n <= 4) return 4;
  let p = 4;
  while (p * 2 <= n) p <<= 1;
  return Math.min(p, 131072);
}

/**
 * Extract a human-readable error message from an unknown thrown value.
 *
 * Priority:
 *   1. Backend custom envelope  → `{ error: { message: "..." } }`
 *   2. FastAPI validation error → `{ detail: "..." | [...] }`
 *   3. Axios HTTP status text   → `err.message`
 *   4. Fallback string
 */
function extractApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = (err as AxiosError<Record<string, unknown>>).response?.data;
    if (data) {
      const envelope = data['error'] as Record<string, unknown> | undefined;
      if (typeof envelope?.message === 'string') return envelope.message;
      if (typeof data['detail'] === 'string') return data['detail'];
      if (Array.isArray(data['detail'])) {
        return (data['detail'] as Array<{ msg?: string }>)
          .map((d) => d.msg ?? '')
          .filter(Boolean)
          .join('; ');
      }
    }
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * Extract a human-readable error message for spectrogram generation failures.
 *
 * Overrides generic envelope messages with SRS-specified user-facing text for
 * known HTTP status codes, then falls back to the general extractor.
 *
 * - 413: payload too large  → guide user to increase overlap / reduce window_size
 * - 422: validation error   → signal too short for the chosen window_size
 */
function extractSpectrogramError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = (err as AxiosError).response?.status;
    if (status === 413) {
      return 'Spectrogram too large — try increasing the overlap (lower hop_size) or reducing window size';
    }
    if (status === 422) {
      return 'Signal is too short for the selected window size. Reduce window size and try again.';
    }
  }
  return extractApiError(err, 'Spectrogram generation failed');
}

// ── State shape ───────────────────────────────────────────────────────────────

export interface STFTExplorerState {
  phase: ExplorationPhase;
  channel: string | null;
  window: ExplorationWindow | null;
  fftResult: STFTResponse | null;
  fftLoading: boolean;
  fftError: string | null;
  windowFn: WindowFunction;
  lockedWindowSize: number | null;
  overlapPct: number;
  spectrogramResult: SpectrogramResponse | null;
  spectrogramLoading: boolean;
  spectrogramError: string | null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SELECT_CHANNEL'; channel: string }
  | { type: 'SET_BRUSH'; window: ExplorationWindow }
  | { type: 'CLEAR_BRUSH' }
  | { type: 'SET_WINDOW_FN'; windowFn: WindowFunction }
  | { type: 'LOCK_WINDOW'; windowSize: number }
  | { type: 'UNLOCK_WINDOW' }
  | { type: 'SET_OVERLAP'; overlapPct: number }
  | { type: 'FFT_LOADING' }
  | { type: 'FFT_SUCCESS'; result: STFTResponse }
  | { type: 'FFT_ERROR'; error: string }
  | { type: 'SPECTROGRAM_LOADING' }
  | { type: 'SPECTROGRAM_SUCCESS'; result: SpectrogramResponse }
  | { type: 'SPECTROGRAM_ERROR'; error: string };

// ── Reducer ───────────────────────────────────────────────────────────────────

const BASE_STATE: STFTExplorerState = {
  phase: 'idle',
  channel: null,
  window: null,
  fftResult: null,
  fftLoading: false,
  fftError: null,
  windowFn: 'hann',
  lockedWindowSize: null,
  overlapPct: 50,
  spectrogramResult: null,
  spectrogramLoading: false,
  spectrogramError: null,
};

function reducer(state: STFTExplorerState, action: Action): STFTExplorerState {
  switch (action.type) {
    case 'SELECT_CHANNEL':
      return { ...BASE_STATE, channel: action.channel };

    case 'SET_BRUSH':
      return {
        ...state,
        window: action.window,
        phase: state.phase === 'idle' ? 'exploring' : state.phase,
      };

    case 'CLEAR_BRUSH':
      return {
        ...state,
        window: null,
        fftResult: null,
        fftError: null,
        fftLoading: false,
        phase: 'idle',
      };

    case 'SET_WINDOW_FN':
      return { ...state, windowFn: action.windowFn };

    case 'LOCK_WINDOW':
      return { ...state, phase: 'locked', lockedWindowSize: action.windowSize };

    case 'UNLOCK_WINDOW':
      return {
        ...state,
        phase: state.fftResult ? 'exploring' : 'idle',
        lockedWindowSize: null,
      };

    case 'SET_OVERLAP':
      return { ...state, overlapPct: action.overlapPct };

    case 'FFT_LOADING':
      return { ...state, fftLoading: true, fftError: null };

    case 'FFT_SUCCESS':
      return {
        ...state,
        fftLoading: false,
        fftResult: action.result,
        phase: state.phase === 'idle' ? 'exploring' : state.phase,
      };

    case 'FFT_ERROR':
      return { ...state, fftLoading: false, fftError: action.error };

    case 'SPECTROGRAM_LOADING':
      return {
        ...state,
        spectrogramLoading: true,
        spectrogramError: null,
        phase: 'generating',
      };

    case 'SPECTROGRAM_SUCCESS':
      return {
        ...state,
        spectrogramLoading: false,
        spectrogramResult: action.result,
        phase: 'spectrogram_ready',
      };

    case 'SPECTROGRAM_ERROR':
      return {
        ...state,
        spectrogramLoading: false,
        spectrogramError: action.error,
        phase: 'locked',
      };

    default:
      return state;
  }
}

// ── Hook public interface ─────────────────────────────────────────────────────

export interface UseSTFTExplorerReturn {
  state: STFTExplorerState;
  windowSize: number | null;
  samplingRateHz: number;
  hopSize: number;
  selectChannel: (channel: string) => void;
  handleBrushSelect: (startS: number, endS: number, explicitChannel?: string) => void;
  clearBrush: () => void;
  lockWindow: () => void;
  unlockWindow: () => void;
  setWindowFn: (fn: WindowFunction) => void;
  setOverlapPct: (pct: number) => void;
  generateSpectrogram: () => void;
}

// ── Hook implementation ───────────────────────────────────────────────────────

export function useSTFTExplorer(
  signalId: string,
  macroX: number[],
  initialChannel?: string,
): UseSTFTExplorerReturn {
  const [state, dispatch] = useReducer(reducer, {
    ...BASE_STATE,
    channel: initialChannel ?? null,
  });

  // Async operation refs
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fftAbort = useRef<AbortController | null>(null);
  const spectrogramAbort = useRef<AbortController | null>(null);

  // Latest-value refs for use inside async closures (avoid stale state)
  // Initialize to initialChannel so the first debounced FFT closure always has
  // a valid channel even before the first useEffect commit (which syncs this ref).
  const channelRef = useRef<string | null>(initialChannel ?? null);
  const windowFnRef = useRef<WindowFunction>('hann');
  useEffect(() => {
    channelRef.current = state.channel;
    windowFnRef.current = state.windowFn;
  });

  // Sync initialChannel if state.channel is currently null
  useEffect(() => {
    if (state.channel === null && initialChannel != null) {
      dispatch({ type: 'SELECT_CHANNEL', channel: initialChannel });
    }
  }, [state.channel, initialChannel]);

  // Estimated sampling rate: use confirmed value from STFT response if available,
  // otherwise derive from macro time axis.
  const samplingRateHz = useMemo(() => {
    if (state.fftResult) return state.fftResult.sampling_rate_hz;
    if (macroX.length < 2) return 1000;
    return (macroX.length - 1) / (macroX[macroX.length - 1] - macroX[0]);
  }, [state.fftResult, macroX]);

  const samplingRateRef = useRef(samplingRateHz);
  useEffect(() => {
    samplingRateRef.current = samplingRateHz;
  });

  // Derived: window size from brush duration
  const windowSize = useMemo(() => {
    if (!state.window) return null;
    const samples = Math.round(
      (state.window.end_s - state.window.start_s) * samplingRateHz,
    );
    return nextPowerOfTwo(Math.max(1, samples));
  }, [state.window, samplingRateHz]);

  // Derived: hop size
  const hopSize = useMemo(() => {
    const ws = state.lockedWindowSize ?? windowSize ?? 1024;
    return Math.max(1, Math.round(ws * (1 - state.overlapPct / 100)));
  }, [state.lockedWindowSize, windowSize, state.overlapPct]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const selectChannel = useCallback((channel: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (fftAbort.current) { fftAbort.current.abort(); fftAbort.current = null; }
    dispatch({ type: 'SELECT_CHANNEL', channel });
  }, []);

  const handleBrushSelect = useCallback(
    (startS: number, endS: number, explicitChannel?: string) => {
      dispatch({ type: 'SET_BRUSH', window: { start_s: startS, end_s: endS } });

      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (fftAbort.current) {
        fftAbort.current.abort();
        fftAbort.current = null;
      }

      // Guard: fewer than 4 samples is insufficient for an FFT. Show an inline
      // warning in the FFT panel without dispatching any API call.
      const earlyCount = Math.round((endS - startS) * samplingRateRef.current);
      if (earlyCount < 4) {
        dispatch({
          type: 'FFT_ERROR',
          error: 'Selection too short — at least 4 samples required for FFT',
        });
        return;
      }

      debounceTimer.current = setTimeout(async () => {
        debounceTimer.current = null;
        const channel = explicitChannel ?? channelRef.current;
        if (!channel) return;

        const samples = Math.round((endS - startS) * samplingRateRef.current);
        const wSize = nextPowerOfTwo(Math.max(1, samples));

        const ac = new AbortController();
        fftAbort.current = ac;
        dispatch({ type: 'FFT_LOADING' });

        try {
          const result = await fetchSTFT(
            signalId,
            {
              channel_name: channel,
              start_s: startS,
              end_s: endS,
              window_fn: windowFnRef.current,
              window_size: wSize,
            },
            ac.signal,
          );
          dispatch({ type: 'FFT_SUCCESS', result });
        } catch (err: unknown) {
          if (axios.isCancel(err)) return;
          if (err instanceof Error && err.name === 'AbortError') return;
          dispatch({ type: 'FFT_ERROR', error: extractApiError(err, 'FFT computation failed') });
        }
      }, 300);
    },
    [signalId],
  );

  const clearBrush = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (fftAbort.current) { fftAbort.current.abort(); fftAbort.current = null; }
    dispatch({ type: 'CLEAR_BRUSH' });
  }, []);

  const lockWindow = useCallback(() => {
    const ws = windowSize ?? 1024;
    dispatch({ type: 'LOCK_WINDOW', windowSize: ws });
  }, [windowSize]);

  const unlockWindow = useCallback(() => {
    dispatch({ type: 'UNLOCK_WINDOW' });
  }, []);

  const setWindowFn = useCallback((fn: WindowFunction) => {
    dispatch({ type: 'SET_WINDOW_FN', windowFn: fn });
  }, []);

  const setOverlapPct = useCallback((pct: number) => {
    dispatch({ type: 'SET_OVERLAP', overlapPct: pct });
  }, []);

  const generateSpectrogram = useCallback(() => {
    const channel = channelRef.current;
    const lockedWs = state.lockedWindowSize;
    if (!channel || !lockedWs || !state.window) return;

    if (spectrogramAbort.current) {
      spectrogramAbort.current.abort();
      spectrogramAbort.current = null;
    }

    // Clamp window_size to the largest power-of-2 that fits within the
    // estimated sample count.  Without this, nextPowerOfTwo can round UP
    // beyond the actual samples in the selected range, causing a 422.
    const estimatedSamples = Math.round(
      (state.window.end_s - state.window.start_s) * samplingRateRef.current,
    );
    const ws = Math.min(lockedWs, prevPowerOfTwo(Math.max(4, estimatedSamples)));
    const hs = Math.max(1, Math.round(ws * (1 - state.overlapPct / 100)));
    const wfn = windowFnRef.current;

    const ac = new AbortController();
    spectrogramAbort.current = ac;
    dispatch({ type: 'SPECTROGRAM_LOADING' });

    fetchSpectrogram(
      signalId,
      {
        channel_name: channel,
        window_fn: wfn,
        window_size: ws,
        hop_size: hs,
        start_s: state.window?.start_s,
        end_s: state.window?.end_s,
      },
      ac.signal,
    )
      .then((result) => {
        dispatch({ type: 'SPECTROGRAM_SUCCESS', result });
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        dispatch({
          type: 'SPECTROGRAM_ERROR',
          error: extractSpectrogramError(err),
        });
      });
  }, [signalId, state.lockedWindowSize, state.overlapPct, state.window]);

  return {
    state,
    windowSize,
    samplingRateHz,
    hopSize,
    selectChannel,
    handleBrushSelect,
    clearBrush,
    lockWindow,
    unlockWindow,
    setWindowFn,
    setOverlapPct,
    generateSpectrogram,
  };
}
