import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { listSignals } from '../lib/api';
import type { SignalMetadata } from '../types/signal';

interface SignalsContextType {
  signals: SignalMetadata[];
  refresh: () => Promise<void>;
}

const SignalsContext = createContext<SignalsContextType | undefined>(undefined);

const POLL_INTERVAL_MS = 2000;

export function SignalsProvider({ children }: { children: React.ReactNode }) {
  const [signals, setSignals] = useState<SignalMetadata[]>([]);
  // Avoid restarting the interval whenever the signals array updates
  const needsPollRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setSignals(await listSignals());
    } catch {
      // Network / auth errors are handled globally by the axios interceptor
    }
  }, []);

  // Initial load
  useEffect(() => { refresh(); }, [refresh]);

  // Keep the "needs polling" flag in sync without restarting the interval
  useEffect(() => {
    needsPollRef.current = signals.some(
      (s) => s.status === 'PENDING' || s.status === 'PROCESSING',
    );
  }, [signals]);

  // Single interval; only fires a request when there is something to wait for
  useEffect(() => {
    const id = setInterval(() => {
      if (needsPollRef.current) refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <SignalsContext.Provider value={{ signals, refresh }}>
      {children}
    </SignalsContext.Provider>
  );
}

export function useSignals(): SignalsContextType {
  const ctx = useContext(SignalsContext);
  if (!ctx) throw new Error('useSignals must be used within SignalsProvider');
  return ctx;
}
