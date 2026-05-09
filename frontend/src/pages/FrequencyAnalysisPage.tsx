import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Activity } from 'lucide-react';
import STFTExplorerPanel from '../components/STFTExplorerPanel';
import { useMacroView } from '../hooks/useMacroView';
import { useSignals } from '../context/SignalsContext';
import { useTheme } from '../context/ThemeContext';

/**
 * Frequency Analysis page — /signals/:id/analysis
 * Renders the STFT Explorer (FFT Spectrum + Spectrogram) for a single signal.
 * The initial time window is read from ?t0=&t1= URL query params so that the
 * range set on the Preview tab is immediately available for STFT computation.
 */
export default function FrequencyAnalysisPage() {
  const { id: signalId } = useParams<{ id: string }>();
  const { signals } = useSignals();
  const { theme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedSignal = signals.find((s) => s.id === signalId);

  // Macro data is needed by STFTExplorerPanel for its internal exploration chart.
  const { macroData, loading, error } = useMacroView(signalId ?? null);

  // Read time window from URL params
  const xRange = useMemo((): [number, number] | null => {
    const t0 = parseFloat(searchParams.get('t0') ?? '');
    const t1 = parseFloat(searchParams.get('t1') ?? '');
    return isNaN(t0) || isNaN(t1) ? null : [t0, t1];
  }, [searchParams]);

  const handleXRangeChange = (r: [number, number] | null) => {
    if (r) {
      setSearchParams({ t0: String(r[0]), t1: String(r[1]) }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
        <Activity size={14} className="animate-spin mr-2" /> Loading signal data…
      </div>
    );
  }

  if (error || !macroData) {
    return (
      <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
        {selectedSignal?.status === 'PROCESSING' && '⏳ Processing — please wait…'}
        {selectedSignal?.status === 'PENDING' && '⏳ Queued for processing…'}
        {selectedSignal?.status === 'FAILED' && `✗ Failed: ${selectedSignal.error_message ?? 'unknown error'}`}
        {(error || (selectedSignal?.status === 'COMPLETED' && !macroData)) && (
          <span className="text-red-400">⚠ Could not load signal data. Return to{' '}
            <Link to={`/signals/${signalId}`} className="underline text-brand-400">Preview</Link>
            {' '}and retry.
          </span>
        )}
        {!selectedSignal && <span className="text-red-400">Signal not found.</span>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <STFTExplorerPanel
        signalId={signalId!}
        channelNames={selectedSignal?.channel_names ?? macroData.channels.map((c) => c.channel_name)}
        macroData={macroData}
        theme={theme}
        xRange={xRange}
        onXRangeChange={handleXRangeChange}
      />
    </div>
  );
}
