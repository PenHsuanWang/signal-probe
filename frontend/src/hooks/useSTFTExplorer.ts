import { useReducer, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
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
  handleBrushSelect: (startS: number, endS: number) => void;
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
  const channelRef = useRef<string | null>(null);
  const windowFnRef = useRef<WindowFunction>('hann');
  channelRef.current = state.channel;
  windowFnRef.current = state.windowFn;

  // Estimated sampling rate: use confirmed value from STFT response if available,
  // otherwise derive from macro time axis.
  const samplingRateHz = useMemo(() => {
    if (state.fftResult) return state.fftResult.sampling_rate_hz;
    if (macroX.length < 2) return 1000;
    return (macroX.length - 1) / (macroX[macroX.length - 1] - macroX[0]);
  }, [state.fftResult, macroX]);

  const samplingRateRef = useRef(samplingRateHz);
  samplingRateRef.current = samplingRateHz;

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
    (startS: number, endS: number) => {
      dispatch({ type: 'SET_BRUSH', window: { start_s: startS, end_s: endS } });

      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (fftAbort.current) {
        fftAbort.current.abort();
        fftAbort.current = null;
      }

      debounceTimer.current = setTimeout(async () => {
        debounceTimer.current = null;
        const channel = channelRef.current;
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
          const msg =
            err instanceof Error ? err.message : 'FFT computation failed';
          dispatch({ type: 'FFT_ERROR', error: msg });
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
    if (!channel || !lockedWs) return;

    if (spectrogramAbort.current) {
      spectrogramAbort.current.abort();
      spectrogramAbort.current = null;
    }

    const ws = lockedWs;
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
      },
      ac.signal,
    )
      .then((result) => {
        dispatch({ type: 'SPECTROGRAM_SUCCESS', result });
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg =
          err instanceof Error ? err.message : 'Spectrogram generation failed';
        dispatch({ type: 'SPECTROGRAM_ERROR', error: msg });
      });
  }, [signalId, state.lockedWindowSize, state.overlapPct]);

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
