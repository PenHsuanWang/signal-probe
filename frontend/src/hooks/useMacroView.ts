import { useCallback, useEffect, useState } from 'react';
import { getMacroView } from '../lib/api';
import { useSignals } from '../context/SignalsContext';
import type { MacroViewResponse } from '../types/signal';

/**
 * Fetches and caches the macro view for a given signal ID.
 * Re-fetches when the signal transitions to COMPLETED status.
 */
export function useMacroView(signalId: string | null): {
  macroData: MacroViewResponse | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const { signals } = useSignals();
  const [macroData, setMacroData] = useState<MacroViewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!signalId) {
      setMacroData(null);
      setError(false);
      return;
    }
    const sig = signals.find((s) => s.id === signalId);
    if (!sig || sig.status !== 'COMPLETED') {
      setMacroData(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    getMacroView(signalId)
      .then((data) => { if (!cancelled) setMacroData(data); })
      .catch(() => { if (!cancelled) { setMacroData(null); setError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [signalId, signals, retryCount]);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  return { macroData, loading, error, retry };
}
