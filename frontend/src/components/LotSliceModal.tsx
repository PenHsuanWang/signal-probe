import { useEffect, useState } from 'react';
import { X, Activity } from 'lucide-react';
import { getLotSlice } from '../lib/api';
import type { LotSliceResponse } from '../types/signal';
import MultiChannelMacroChart from './MultiChannelMacroChart';
import { useTheme } from '../context/ThemeContext';

interface Props {
  signalId: string;
  lotId: string | null;
  onClose: () => void;
}

/**
 * Dialog that fetches the lot-sliced MacroViewResponse and renders it
 * in a MultiChannelMacroChart so the user can inspect the signal window
 * aligned to a specific lot's check-in / check-out times.
 */
export default function LotSliceModal({ signalId, lotId, onClose }: Props) {
  const { theme } = useTheme();
  const [slice, setSlice] = useState<LotSliceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lotId) return;
    let cancelled = false;
    setSlice(null);
    setError(null);
    setLoading(true);
    getLotSlice(signalId, lotId)
      .then((data) => { if (!cancelled) setSlice(data); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load lot slice.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [signalId, lotId]);

  if (!lotId) return null;

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Lot slice – ${lotId}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-5xl rounded-xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}
      >
        {/* Modal header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--sp-border)' }}
        >
          <div>
            <h2 className="text-sm font-semibold font-sans" style={{ color: 'var(--sp-text-primary)' }}>
              Lot Slice
            </h2>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
              {lotId}
              {slice?.lot_event && (
                <>
                  {' · '}recipe {slice.lot_event.recipe}
                  {' · '}n={slice.lot_event.wafer_count}
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close lot slice modal"
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: 'var(--sp-text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Chart area */}
        <div className="p-4">
          {loading && (
            <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
              <Activity size={14} className="animate-spin mr-2" /> Loading slice…
            </div>
          )}
          {error && (
            <div className="h-64 flex items-center justify-center font-sans text-xs text-red-400">
              ⚠ {error}
            </div>
          )}
          {slice && (
            <MultiChannelMacroChart
              macro={slice}
              visibleChannels={new Set(slice.channels.map((c) => c.channel_name))}
              theme={theme}
              onRelayout={() => {/* read-only view */}}
            />
          )}
        </div>
      </div>
    </div>
  );
}
