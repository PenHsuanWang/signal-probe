import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getSpectrogram, getStft } from '../lib/api';
import type {
  SpectrogramResponse,
  STFTResponse,
  WindowFunction,
} from '../types/signal';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface STFTState {
  channelName: string | null;
  windowFn: WindowFunction;
  windowSize: number;
  startS: number;
  endS: number;
  hopSize: number;

  stftStatus: 'idle' | 'loading' | 'ready' | 'error';
  spectrum: STFTResponse | null;
  stftError: string | null;

  spectrogramStatus: 'idle' | 'loading' | 'ready' | 'error';
  spectrogram: SpectrogramResponse | null;
  spectrogramError: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'SET_CHANNEL'; payload: string }
  | { type: 'SET_WINDOW_FN'; payload: WindowFunction }
  | { type: 'SET_WINDOW_SIZE'; payload: number }
  | { type: 'SET_HOP_SIZE'; payload: number }
  | { type: 'SET_WINDOW_BOUNDS'; payload: { startS: number; endS: number } }
  | { type: 'STFT_LOADING' }
  | { type: 'STFT_SUCCESS'; payload: STFTResponse }
  | { type: 'STFT_ERROR'; payload: string }
  | { type: 'SPECTROGRAM_LOADING' }
  | { type: 'SPECTROGRAM_SUCCESS'; payload: SpectrogramResponse }
  | { type: 'SPECTROGRAM_ERROR'; payload: string }
  | { type: 'CLEAR_SPECTROGRAM' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const INITIAL_STATE: STFTState = {
  channelName: null,
  windowFn: 'hann',
  windowSize: 1024,
  startS: 0,
  endS: 1,
  hopSize: 512,
  stftStatus: 'idle',
  spectrum: null,
  stftError: null,
  spectrogramStatus: 'idle',
  spectrogram: null,
  spectrogramError: null,
};

function reducer(state: STFTState, action: Action): STFTState {
  switch (action.type) {
    case 'SET_CHANNEL':
      return {
        ...state,
        channelName: action.payload,
        stftStatus: 'idle',
        spectrum: null,
        stftError: null,
        spectrogramStatus: 'idle',
        spectrogram: null,
        spectrogramError: null,
      };
    case 'SET_WINDOW_FN':
      return { ...state, windowFn: action.payload };
    case 'SET_WINDOW_SIZE':
      return { ...state, windowSize: action.payload };
    case 'SET_HOP_SIZE':
      return { ...state, hopSize: action.payload };
    case 'SET_WINDOW_BOUNDS':
      return { ...state, startS: action.payload.startS, endS: action.payload.endS };
    case 'STFT_LOADING':
      return { ...state, stftStatus: 'loading', stftError: null };
    case 'STFT_SUCCESS':
      return { ...state, stftStatus: 'ready', spectrum: action.payload, stftError: null };
    case 'STFT_ERROR':
      return { ...state, stftStatus: 'error', stftError: action.payload };
    case 'SPECTROGRAM_LOADING':
      return { ...state, spectrogramStatus: 'loading', spectrogramError: null };
    case 'SPECTROGRAM_SUCCESS':
      return { ...state, spectrogramStatus: 'ready', spectrogram: action.payload, spectrogramError: null };
    case 'SPECTROGRAM_ERROR':
      return { ...state, spectrogramStatus: 'error', spectrogramError: action.payload };
    case 'CLEAR_SPECTROGRAM':
      return { ...state, spectrogramStatus: 'idle', spectrogram: null, spectrogramError: null };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Public return interface
// ---------------------------------------------------------------------------

export interface UseSTFTReturn {
  channelName: string | null;
  windowFn: WindowFunction;
  windowSize: number;
  startS: number;
  endS: number;
  hopSize: number;

  stftStatus: STFTState['stftStatus'];
  spectrum: STFTResponse | null;
  stftError: string | null;

  spectrogramStatus: STFTState['spectrogramStatus'];
  spectrogram: SpectrogramResponse | null;
  spectrogramError: string | null;

  setChannel: (name: string) => void;
  setWindowFn: (fn: WindowFunction) => void;
  setWindowSize: (size: number) => void;
  setHopSize: (size: number) => void;
  setWindowBounds: (startS: number, endS: number) => void;
  computeSpectrogram: () => void;
  clearSpectrogram: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150;

/**
 * useSTFT — manages STFT window configuration, fetching, and spectrogram state
 * for a single signal.
 *
 * Window bound changes debounce 150 ms before firing the STFT fetch.
 * Spectrogram computation is always user-initiated via `computeSpectrogram()`.
 *
 * @param signalId - UUID of the (COMPLETED) signal to analyse.
 */
export function useSTFT(signalId: string): UseSTFTReturn {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // ── Refs to track inflight fetch cancellation ────────────────────────────
  const stftAbortRef = useRef<AbortController | null>(null);
  const spectrogramAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── STFT fetch ───────────────────────────────────────────────────────────
  const fetchStft = useCallback(
    async (
      channelName: string,
      startS: number,
      endS: number,
      windowFn: WindowFunction,
      windowSize: number,
    ) => {
      stftAbortRef.current?.abort();
      const ctrl = new AbortController();
      stftAbortRef.current = ctrl;

      dispatch({ type: 'STFT_LOADING' });
      try {
        const data = await getStft(signalId, {
          channel_name: channelName,
          start_s: startS,
          end_s: endS,
          window_fn: windowFn,
          window_size: windowSize,
        });
        if (!ctrl.signal.aborted) dispatch({ type: 'STFT_SUCCESS', payload: data });
      } catch (err: unknown) {
        if (!ctrl.signal.aborted) {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            'STFT computation failed';
          dispatch({ type: 'STFT_ERROR', payload: detail });
        }
      }
    },
    [signalId],
  );

  // ── Debounced effect: fire STFT when channel + bounds change ─────────────
  const { channelName, startS, endS, windowFn, windowSize } = state;

  useEffect(() => {
    if (!channelName) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchStft(channelName, startS, endS, windowFn, windowSize);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [channelName, startS, endS, windowFn, windowSize, fetchStft]);

  // ── Spectrogram (user-initiated) ─────────────────────────────────────────
  const computeSpectrogram = useCallback(async () => {
    if (!state.channelName) return;

    spectrogramAbortRef.current?.abort();
    const ctrl = new AbortController();
    spectrogramAbortRef.current = ctrl;

    dispatch({ type: 'SPECTROGRAM_LOADING' });
    try {
      const data = await getSpectrogram(signalId, {
        channel_name: state.channelName,
        window_fn: state.windowFn,
        window_size: state.windowSize,
        hop_size: state.hopSize,
      });
      if (!ctrl.signal.aborted) dispatch({ type: 'SPECTROGRAM_SUCCESS', payload: data });
    } catch (err: unknown) {
      if (!ctrl.signal.aborted) {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Spectrogram computation failed';
        dispatch({ type: 'SPECTROGRAM_ERROR', payload: detail });
      }
    }
  }, [signalId, state.channelName, state.windowFn, state.windowSize, state.hopSize]);

  // ── Action callbacks ─────────────────────────────────────────────────────
  const setChannel = useCallback((name: string) => {
    dispatch({ type: 'SET_CHANNEL', payload: name });
  }, []);

  const setWindowFn = useCallback((fn: WindowFunction) => {
    dispatch({ type: 'SET_WINDOW_FN', payload: fn });
  }, []);

  const setWindowSize = useCallback((size: number) => {
    dispatch({ type: 'SET_WINDOW_SIZE', payload: size });
  }, []);

  const setHopSize = useCallback((size: number) => {
    dispatch({ type: 'SET_HOP_SIZE', payload: size });
  }, []);

  const setWindowBounds = useCallback((s: number, e: number) => {
    dispatch({ type: 'SET_WINDOW_BOUNDS', payload: { startS: s, endS: e } });
  }, []);

  const clearSpectrogram = useCallback(() => {
    dispatch({ type: 'CLEAR_SPECTROGRAM' });
  }, []);

  return {
    channelName: state.channelName,
    windowFn: state.windowFn,
    windowSize: state.windowSize,
    startS: state.startS,
    endS: state.endS,
    hopSize: state.hopSize,
    stftStatus: state.stftStatus,
    spectrum: state.spectrum,
    stftError: state.stftError,
    spectrogramStatus: state.spectrogramStatus,
    spectrogram: state.spectrogram,
    spectrogramError: state.spectrogramError,
    setChannel,
    setWindowFn,
    setWindowSize,
    setHopSize,
    setWindowBounds,
    computeSpectrogram,
    clearSpectrogram,
  };
}
