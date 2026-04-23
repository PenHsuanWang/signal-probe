import { useCallback, useState } from 'react';
import { Download, BarChart2 } from 'lucide-react';
import { Plot } from '../lib/plot';
import { buildChartTheme } from '../lib/chartTheme';
import type { STFTResponse } from '../types/signal';
import type { Theme } from '../context/ThemeContext';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  spectrum: STFTResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  theme: Theme;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exportCsv(spectrum: STFTResponse) {
  const rows = ['frequency_hz,magnitude'];
  spectrum.frequencies_hz.forEach((f, i) => {
    rows.push(`${f},${spectrum.magnitudes[i]}`);
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spectrum_${spectrum.channel_name}_${spectrum.window_config.start_s.toFixed(2)}s.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SpectrumChart — displays the FFT magnitude spectrum returned by the STFT
 * endpoint as a Plotly bar chart.
 *
 * Features:
 * - Dominant frequency annotation (vertical dashed line + label)
 * - Linear / log Y-axis toggle
 * - CSV export (frequency_hz, magnitude columns)
 */
export default function SpectrumChart({ spectrum, status, error, theme }: Props) {
  const [logScale, setLogScale] = useState(false);

  const handleExport = useCallback(() => {
    if (spectrum) exportCsv(spectrum);
  }, [spectrum]);

  if (status === 'idle') {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2 py-8"
        style={{ color: 'var(--sp-text-tertiary)' }}
      >
        <BarChart2 size={28} className="opacity-30" />
        <p className="text-xs font-sans">Select a channel and drag the window to see the spectrum.</p>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div
        className="flex items-center justify-center h-full py-8 text-xs font-sans animate-pulse"
        style={{ color: 'var(--sp-text-secondary)' }}
      >
        Computing spectrum…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex items-center justify-center h-full py-8 text-xs font-sans text-red-400"
      >
        {error ?? 'STFT computation failed.'}
      </div>
    );
  }

  if (!spectrum) return null;

  const base = buildChartTheme(theme);
  const dominantHz = spectrum.dominant_frequency_hz;

  const shapes: Plotly.Shape[] = dominantHz != null
    ? [
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: dominantHz,
          x1: dominantHz,
          y0: 0,
          y1: 1,
          line: { color: '#f87171', width: 1.5, dash: 'dash' },
        } as Plotly.Shape,
      ]
    : [];

  const annotations: Partial<Plotly.Annotations>[] = dominantHz != null
    ? [
        {
          x: dominantHz,
          y: 1,
          xref: 'x',
          yref: 'paper',
          text: `${dominantHz.toFixed(2)} Hz`,
          showarrow: false,
          font: { size: 10, color: '#f87171' },
          xanchor: 'left',
          yanchor: 'top',
          xshift: 4,
        },
      ]
    : [];

  const layout: Partial<Plotly.Layout> = {
    ...base,
    height: 220,
    margin: { t: 8, r: 12, l: 52, b: 44 },
    xaxis: {
      ...(base.xaxis as object),
      title: { text: 'Frequency (Hz)', font: { size: 11 } },
    },
    yaxis: {
      ...(base.yaxis as object),
      title: { text: 'Magnitude', font: { size: 11 } },
      type: logScale ? 'log' : 'linear',
    },
    shapes,
    annotations,
    bargap: 0,
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-1">
        <span
          className="text-[10px] font-sans font-semibold uppercase tracking-wide mr-auto"
          style={{ color: 'var(--sp-text-tertiary)' }}
        >
          Spectrum · {spectrum.window_config.start_s.toFixed(2)}s – {spectrum.window_config.end_s.toFixed(2)}s
        </span>
        <button
          onClick={() => setLogScale((v) => !v)}
          className={`text-[10px] font-sans px-2 py-0.5 rounded border transition-colors ${
            logScale ? 'border-brand-500/60 text-brand-400' : ''
          }`}
          style={!logScale ? { border: '1px solid var(--sp-border)', color: 'var(--sp-text-secondary)' } : {}}
          aria-pressed={logScale}
          title="Toggle log Y scale"
        >
          log
        </button>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 text-[10px] font-sans px-2 py-0.5 rounded border transition-colors hover:text-brand-400"
          style={{ border: '1px solid var(--sp-border)', color: 'var(--sp-text-secondary)' }}
          title="Export spectrum as CSV"
          aria-label="Export spectrum CSV"
        >
          <Download size={10} />
          CSV
        </button>
      </div>

      {/* Chart */}
      <Plot
        data={[
          {
            type: 'bar',
            x: spectrum.frequencies_hz,
            y: spectrum.magnitudes,
            marker: { color: '#3b82f6', opacity: 0.85 },
            name: 'Magnitude',
            hovertemplate: '%{x:.2f} Hz — %{y:.4g}<extra></extra>',
          },
        ]}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
      />

      {dominantHz != null && (
        <p
          className="text-[10px] font-mono text-center"
          style={{ color: 'var(--sp-text-tertiary)' }}
        >
          Dominant: {dominantHz.toFixed(3)} Hz · SR: {spectrum.sampling_rate_hz.toFixed(1)} Hz
        </p>
      )}
    </div>
  );
}
