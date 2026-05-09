import { useEffect, useState } from 'react';
import { getRunChunks } from '../lib/api';
import type { MacroViewResponse, RunChunkResponse } from '../types/signal';

/**
 * Fetches run chunks that intersect the given time window [xRange[0], xRange[1]].
 * Automatically aborts and re-fetches when signalId or xRange changes.
 */
export function useRunChunks(
  signalId: string | null,
  xRange: [number, number] | null,
  macroData: MacroViewResponse | null,
): {
  runChunks: RunChunkResponse[];
  loading: boolean;
  error: boolean;
} {
  const [runChunks, setRunChunks] = useState<RunChunkResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!signalId || !xRange || !macroData) {
      setRunChunks([]);
      return;
    }
    const [x0, x1] = xRange;
    const visible = macroData.runs.filter((r) => r.start_x < x1 && r.end_x > x0);
    if (!visible.length) {
      setRunChunks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    getRunChunks(signalId, visible.map((r) => r.run_id))
      .then((chunks) => { if (!cancelled) setRunChunks(chunks); })
      .catch(() => { if (!cancelled) { setRunChunks([]); setError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [signalId, xRange, macroData]);

  return { runChunks, loading, error };
}
