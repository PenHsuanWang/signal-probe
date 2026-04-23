import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ChevronLeft, AlertTriangle, Loader } from 'lucide-react';
import { getSignal, getMacroView } from '../lib/api';
import STFTPanel from '../components/STFTPanel';
import { useTheme } from '../context/ThemeContext';
import type { MacroViewResponse, SignalMetadata } from '../types/signal';

// ---------------------------------------------------------------------------
// Fetch state
// ---------------------------------------------------------------------------

type LoadStatus = 'loading' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * AnalysisPage — full STFT spectral analysis view for a single signal.
 *
 * Route: /signals/:id/analysis
 *
 * Fetches signal metadata + macro view on mount, then renders `STFTPanel`.
 * Signals that are not COMPLETED show an explanatory message.
 */
export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [signal, setSignal] = useState<SignalMetadata | null>(null);
  const [macro, setMacro] = useState<MacroViewResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { navigate('/signals'); return; }
    setLoadStatus('loading');
    try {
      const [sig, mac] = await Promise.all([getSignal(id), getMacroView(id)]);
      setSignal(sig);
      setMacro(mac);
      setLoadStatus('ready');
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to load signal.';
      setLoadError(detail);
      setLoadStatus('error');
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loadStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[40vh] gap-2"
           style={{ color: 'var(--sp-text-secondary)' }}>
        <Loader size={16} className="animate-spin" />
        <span className="text-xs font-sans">Loading signal…</span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (loadStatus === 'error') {
    return (
      <div className="max-w-2xl mx-auto mt-16 space-y-4">
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-red-500/20 p-4"
          style={{ background: 'var(--sp-surface-secondary)' }}
        >
          <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-sans font-semibold text-red-400">Could not load signal</p>
            <p className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>
              {loadError}
            </p>
          </div>
        </div>
        <Link
          to="/signals"
          className="inline-flex items-center gap-1 text-xs font-sans text-brand-400 hover:text-blue-300 transition-colors"
        >
          <ChevronLeft size={12} />
          Back to Signals
        </Link>
      </div>
    );
  }

  // ── Not COMPLETED ────────────────────────────────────────────────────────
  if (signal && signal.status !== 'COMPLETED') {
    return (
      <div className="max-w-2xl mx-auto mt-16 space-y-4">
        <div
          className="flex items-start gap-3 rounded-lg border border-yellow-500/20 p-4"
          style={{ background: 'var(--sp-surface-secondary)' }}
        >
          <AlertTriangle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-sans font-semibold" style={{ color: 'var(--sp-text-primary)' }}>
              Signal not ready
            </p>
            <p className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>
              Spectral analysis requires a <strong>COMPLETED</strong> signal. Current status:{' '}
              <span className="font-mono text-yellow-400">{signal.status}</span>.
            </p>
          </div>
        </div>
        <Link
          to="/signals"
          className="inline-flex items-center gap-1 text-xs font-sans text-brand-400 hover:text-blue-300 transition-colors"
        >
          <ChevronLeft size={12} />
          Back to Signals
        </Link>
      </div>
    );
  }

  if (!signal || !macro) return null;

  // ── Main layout ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* Breadcrumb header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/signals"
            className="flex items-center gap-1 text-xs font-sans transition-colors hover:text-brand-400"
            style={{ color: 'var(--sp-text-tertiary)' }}
            aria-label="Back to Signals"
          >
            <ChevronLeft size={13} />
            Signals
          </Link>
          <span style={{ color: 'var(--sp-text-tertiary)' }}>/</span>
          <span
            className="text-xs font-mono truncate max-w-[260px]"
            style={{ color: 'var(--sp-text-secondary)' }}
            title={signal.original_filename}
          >
            {signal.original_filename}
          </span>
          <span style={{ color: 'var(--sp-text-tertiary)' }}>/</span>
          <span
            className="text-xs font-sans font-semibold"
            style={{ color: 'var(--sp-text-primary)' }}
          >
            Spectral Analysis
          </span>
        </div>
      </div>

      {/* Panel */}
      <STFTPanel signal={signal} macro={macro} theme={theme} />

    </div>
  );
}
