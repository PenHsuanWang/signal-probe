import { useMemo } from 'react';
import { Plot } from '../lib/plot';
import { buildChartTheme } from '../lib/chartTheme';
import type { STFTResponse } from '../types/signal';
import type { Theme } from '../context/ThemeContext';

interface Props {
  result: STFTResponse | null;
  loading: boolean;
  error: string | null;
  theme: Theme;
}

export default function FFTSpectrumChart({ result, loading, error, theme }: Props) {
  const isLight = theme === 'light';
  const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
  const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

  const traces = useMemo((): Plotly.Data[] => {
    if (!result) return [];
    return [
      {
        x: result.frequencies_hz,
        y: result.magnitudes,
        type: 'scatter',
        mode: 'lines',
        name: 'Magnitude',
        line: { color: '#3b82f6', width: 1.5 },
        fill: 'tozeroy',
        fillcolor: 'rgba(59,130,246,0.08)',
        hovertemplate: '%{x:.3f} Hz<br>%{y:.4f}<extra></extra>',
      } as Plotly.Data,
    ];
  }, [result]);

  const layout = useMemo((): Partial<Plotly.Layout> => {
    const base = buildChartTheme(theme);
    const shapes: Partial<Plotly.Shape>[] = result?.dominant_frequency_hz != null
      ? [
          {
            type: 'line',
            x0: result.dominant_frequency_hz,
            x1: result.dominant_frequency_hz,
            y0: 0,
            y1: 1,
            yref: 'paper',
            xref: 'x',
            line: { color: '#f59e0b', width: 1.5, dash: 'dash' },
          },
        ]
      : [];

    return {
      ...base,
      margin: { t: 8, r: 12, l: 52, b: 44 },
      shapes: shapes as Plotly.Shape[],
      xaxis: {
        color: axisColor,
        gridcolor: gridColor,
        title: {
          text: 'Frequency (Hz)',
          font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        },
        tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        ticks: 'inside',
        tickcolor: axisColor,
        linecolor: axisColor,
        linewidth: 1,
        showline: true,
      },
      yaxis: {
        color: axisColor,
        gridcolor: gridColor,
        title: {
          text: 'Magnitude',
          font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        },
        tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        ticks: 'inside',
        tickcolor: axisColor,
        linecolor: axisColor,
        linewidth: 1,
        showline: true,
        rangemode: 'tozero',
      },
    };
  }, [result, theme, axisColor, gridColor]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[180px] text-xs font-sans"
           style={{ color: 'var(--sp-text-tertiary)' }}>
        <span className="animate-pulse">Computing FFT…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full min-h-[180px] text-xs font-sans text-red-400 px-4 text-center">
        ⚠ {error}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full min-h-[180px] text-xs font-sans"
           style={{ color: 'var(--sp-text-tertiary)' }}>
        Drag a selection on the chart above to compute FFT
      </div>
    );
  }

  const freqRes = result.frequencies_hz.length > 1
    ? result.frequencies_hz[1] - result.frequencies_hz[0]
    : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-1 pb-1 text-[10px] font-mono"
           style={{ color: 'var(--sp-text-tertiary)' }}>
        <span>
          <span style={{ color: 'var(--sp-text-secondary)' }}>{result.window_config.window_size}</span> samples
          @ <span style={{ color: 'var(--sp-text-secondary)' }}>{result.sampling_rate_hz.toFixed(0)}</span> Hz
        </span>
        <span>
          Duration: <span style={{ color: 'var(--sp-text-secondary)' }}>
            {((result.window_config.end_s - result.window_config.start_s) * 1000).toFixed(0)}
          </span> ms
        </span>
        <span>
          Freq res: <span style={{ color: 'var(--sp-text-secondary)' }}>{freqRes.toFixed(3)}</span> Hz
        </span>
        <span className="text-amber-400">
          Dominant: {result.dominant_frequency_hz != null ? `${result.dominant_frequency_hz.toFixed(2)} Hz` : '—'}
        </span>
      </div>
      <Plot
        data={traces}
        layout={layout}
        useResizeHandler
        style={{ width: '100%', flex: 1, minHeight: '160px' }}
        config={{ displayModeBar: false }}
      />
    </div>
  );
}
