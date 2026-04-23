import { useCallback, useRef, useState } from 'react';
import { Download, Activity } from 'lucide-react';
import _Plotly from 'plotly.js-dist-min';
import { Plot } from '../lib/plot';
import { buildChartTheme } from '../lib/chartTheme';
import type { SpectrogramResponse } from '../types/signal';
import type { Theme } from '../context/ThemeContext';

// Vite ESM interop: same pattern as lib/plot.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PlotlyInstance = (_Plotly && typeof _Plotly === 'object' && 'default' in _Plotly ? (_Plotly as any).default : _Plotly) as typeof _Plotly;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORSCALES = ['Viridis', 'Plasma', 'Inferno', 'Hot', 'Jet', 'Greys'] as const;
type Colorscale = (typeof COLORSCALES)[number];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  spectrogram: SpectrogramResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  theme: Theme;
  /** Whether the channel has been selected (enables Compute button). */
  canCompute: boolean;
  onCompute: () => void;
  onClear: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SpectrogramHeatmap — renders the full-signal STFT spectrogram as a Plotly
 * heatmap in dBFS.
 *
 * Computation is always user-initiated via the "Compute Spectrogram" button.
 *
 * Features:
 * - Colorscale selector
 * - PNG export via Plotly.toImage
 * - Downsampled indicator when the time axis was reduced by the backend
 */
export default function SpectrogramHeatmap({
  spectrogram,
  status,
  error,
  theme,
  canCompute,
  onCompute,
  onClear,
}: Props) {
  const [colorscale, setColorscale] = useState<Colorscale>('Viridis');
  const plotRef = useRef<{ el: HTMLDivElement | null }>({ el: null });

  const handleExportPng = useCallback(async () => {
    if (!plotRef.current.el) return;
    try {
      const url: string = await PlotlyInstance.toImage(plotRef.current.el, {
        format: 'png',
        width: 1200,
        height: 400,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `spectrogram_${spectrogram?.channel_name ?? 'signal'}.png`;
      a.click();
    } catch { /* ignore export errors */ }
  }, [spectrogram]);

  // ── Empty / loading / error states ───────────────────────────────────────

  if (status === 'idle') {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-3 py-8 rounded-lg border"
        style={{
          border: '1px solid var(--sp-border)',
          color: 'var(--sp-text-tertiary)',
        }}
      >
        <Activity size={28} className="opacity-30" />
        <p className="text-xs font-sans text-center max-w-[220px]">
          Compute the full-signal spectrogram to see time-frequency content.
        </p>
        <button
          disabled={!canCompute}
          onClick={onCompute}
          className="px-4 py-1.5 text-xs font-sans rounded bg-brand-500 text-white hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Compute spectrogram"
        >
          Compute Spectrogram
        </button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 py-8 rounded-lg border"
        style={{ border: '1px solid var(--sp-border)', color: 'var(--sp-text-secondary)' }}
      >
        <Activity size={24} className="animate-pulse" />
        <p className="text-xs font-sans animate-pulse">Computing spectrogram…</p>
        <p className="text-[10px] font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>
          This may take a few seconds for long signals.
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-2 py-8 rounded-lg border border-red-500/20"
        style={{ color: 'var(--sp-text-secondary)' }}
      >
        <p className="text-xs font-sans text-red-400">{error ?? 'Spectrogram failed.'}</p>
        <button
          onClick={onClear}
          className="text-[10px] font-sans px-3 py-1 rounded border transition-colors hover:text-brand-400"
          style={{ border: '1px solid var(--sp-border)', color: 'var(--sp-text-tertiary)' }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (!spectrogram) return null;

  const base = buildChartTheme(theme);
  const layout = {
    ...base,
    height: 280,
    margin: { t: 8, r: 16, l: 60, b: 44 },
    xaxis: {
      ...(base.xaxis as object),
      title: { text: 'Time (s)', font: { size: 11 } },
    },
    yaxis: {
      ...(base.yaxis as object),
      title: { text: 'Frequency (Hz)', font: { size: 11 } },
    },
    coloraxis: {
      colorscale,
      colorbar: {
        title: { text: 'dBFS', side: 'right' as const },
        thickness: 14,
        len: 0.8,
        tickfont: { size: 10 },
      },
    },
  } as unknown as Partial<Plotly.Layout>;

  // Transpose magnitude_db: backend returns [n_time × n_freq]; heatmap z is [row=freq, col=time]
  const zData = spectrogram.frequency_bins_hz.map((_, fi) =>
    spectrogram.time_bins_s.map((_, ti) => spectrogram.magnitude_db[ti][fi]),
  );

  return (
    <div className="flex flex-col gap-1">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <span
          className="text-[10px] font-sans font-semibold uppercase tracking-wide mr-auto"
          style={{ color: 'var(--sp-text-tertiary)' }}
        >
          Spectrogram{spectrogram.downsampled ? ' (downsampled)' : ''}
        </span>

        {/* Colorscale selector */}
        <select
          value={colorscale}
          onChange={(e) => setColorscale(e.target.value as Colorscale)}
          className="text-xs font-mono rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
          style={{
            background: 'var(--sp-surface-elevated)',
            border: '1px solid var(--sp-border)',
            color: 'var(--sp-text-primary)',
          }}
          aria-label="Colorscale"
        >
          {COLORSCALES.map((cs) => (
            <option key={cs} value={cs}>{cs}</option>
          ))}
        </select>

        {/* PNG export */}
        <button
          onClick={handleExportPng}
          className="flex items-center gap-1 text-[10px] font-sans px-2 py-0.5 rounded border transition-colors hover:text-brand-400"
          style={{ border: '1px solid var(--sp-border)', color: 'var(--sp-text-secondary)' }}
          title="Export spectrogram as PNG"
          aria-label="Export spectrogram PNG"
        >
          <Download size={10} />
          PNG
        </button>

        {/* Re-compute / clear */}
        <button
          onClick={onClear}
          className="text-[10px] font-sans px-2 py-0.5 rounded border transition-colors hover:text-brand-400"
          style={{ border: '1px solid var(--sp-border)', color: 'var(--sp-text-secondary)' }}
          aria-label="Clear spectrogram"
        >
          Clear
        </button>
      </div>

      {/* Heatmap */}
      <div ref={(el) => { plotRef.current.el = el; }}>
        <Plot
          data={[
            {
              type: 'heatmap',
              x: spectrogram.time_bins_s,
              y: spectrogram.frequency_bins_hz,
              z: zData,
              coloraxis: 'coloraxis',
              hovertemplate: 't=%{x:.2f}s  f=%{y:.1f}Hz  %{z:.1f}dBFS<extra></extra>',
            } as unknown as Plotly.Data,
          ]}
          layout={layout}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}
