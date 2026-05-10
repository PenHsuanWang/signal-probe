import { useCallback, useEffect, useState } from 'react';
import {
  createLotEvent,
  deleteLotEvent,
  listLotEvents,
  uploadLotEventsCsv,
} from '../lib/api';
import type {
  BulkImportResult,
  LotEvent,
  LotEventCreateRequest,
} from '../types/signal';

/**
 * Fetches and manages lot events for a given signal.
 *
 * State classification: server/async state → useState + useEffect
 * (follows the project's existing hook convention; no TanStack Query).
 */
export function useLotEvents(signalId: string | null): {
  events: LotEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  create: (data: LotEventCreateRequest) => Promise<void>;
  remove: (eventId: string) => Promise<void>;
  uploadCsv: (file: File) => Promise<BulkImportResult>;
} {
  const [events, setEvents] = useState<LotEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((c) => c + 1), []);

  useEffect(() => {
    if (!signalId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listLotEvents(signalId)
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load lot events';
          setError(msg);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [signalId, tick]);

  const create = useCallback(
    async (data: LotEventCreateRequest) => {
      if (!signalId) return;
      await createLotEvent(signalId, data);
      refetch();
    },
    [signalId, refetch],
  );

  const remove = useCallback(
    async (eventId: string) => {
      if (!signalId) return;
      await deleteLotEvent(signalId, eventId);
      refetch();
    },
    [signalId, refetch],
  );

  const uploadCsv = useCallback(
    async (file: File): Promise<BulkImportResult> => {
      if (!signalId) throw new Error('No signal selected');
      const result = await uploadLotEventsCsv(signalId, file);
      refetch();
      return result;
    },
    [signalId, refetch],
  );

  return { events, loading, error, refetch, create, remove, uploadCsv };
}
