import { useMemo } from 'react';
import { Plot } from '../lib/plot';
import { buildChartTheme } from '../lib/chartTheme';
import type { SpectrogramResponse, ExplorationWindow } from '../types/signal';
import type { Theme } from '../context/ThemeContext';

interface Props {
  result: SpectrogramResponse | null;
  loading: boolean;
  error: string | null;
  theme: Theme;
  t0EpochS: number | null;
  brushWindow: ExplorationWindow | null;
  xRange: [number, number] | null;
  onXRangeChange: (r: [number, number]) => void;
}

export default function SpectrogramChart({
  result,
  loading,
  error,
  theme,
  t0EpochS,
  brushWindow,
  xRange,
  onXRangeChange,
}: Props) {
  const isLight = theme === 'light';
  const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
  const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

  const toX = useMemo((): ((s: number) => number | string) => {
    if (t0EpochS == null) return (s: number) => s;
    return (s: number) => new Date((t0EpochS + s) * 1000).toISOString();
  }, [t0EpochS]);

  const traces = useMemo((): Plotly.Data[] => {
    if (!result) return [];

    const xValues = result.time_bins_s.map((s) => toX(s));

    return [
      {
        z: result.magnitude_db,
        x: xValues,
        y: result.frequency_bins_hz,
        type: 'heatmap',
        colorscale: 'Viridis',
        zsmooth: 'fast',
        colorbar: {
          title: { text: 'dBFS', font: { size: 10, color: axisColor } },
          thickness: 14,
          len: 0.9,
          tickfont: { size: 9, color: axisColor },
        },
        hovertemplate:
          (t0EpochS == null ? 'Time: %{x:.3f} s' : 'Time: %{x}') +
          '<br>Freq: %{y:.2f} Hz<br>%{z:.1f} dBFS<extra></extra>',
      } as Plotly.Data,
    ];
  }, [result, toX, axisColor, t0EpochS]);

  const layout = useMemo((): Partial<Plotly.Layout> => {
    const base = buildChartTheme(theme);

    const brushShapes: Partial<Plotly.Shape>[] =
      brushWindow
        ? [
            {
              type: 'rect',
              x0: toX(brushWindow.start_s),
              x1: toX(brushWindow.end_s),
              y0: 0,
              y1: 1,
              xref: 'x',
              yref: 'paper',
              fillcolor: 'rgba(251,191,36,0.10)',
              line: { color: '#fbbf24', width: 1, dash: 'dot' },
              layer: 'above',
            },
          ]
        : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l: Record<string, any> = {
      ...base,
      margin: { t: 8, r: 80, l: 56, b: 52 },
      shapes: brushShapes,
      xaxis: {
        color: axisColor,
        gridcolor: gridColor,
        title: {
          text: t0EpochS == null ? 'Time (s)' : 'Date / Time',
          font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        },
        tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        ticks: 'inside',
        tickcolor: axisColor,
        linecolor: axisColor,
        linewidth: 1,
        showline: true,
        ...(t0EpochS != null ? { type: 'date' } : {}),
        ...(xRange ? { range: xRange.map((s) => toX(s)) } : {}),
      },
      yaxis: {
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
    };

    return l as Partial<Plotly.Layout>;
  }, [result, theme, axisColor, gridColor, brushWindow, xRange, toX, t0EpochS]);

  const handleRelayout = (event: Plotly.PlotRelayoutEvent) => {
    const ev = event as unknown as Record<string, unknown>;
    const r0 = ev['xaxis.range[0]'];
    const r1 = ev['xaxis.range[1]'];
    if (r0 !== undefined && r1 !== undefined) {
      if (t0EpochS != null) {
        const t0 = new Date(r0 as string).getTime() / 1000 - t0EpochS;
        const t1 = new Date(r1 as string).getTime() / 1000 - t0EpochS;
        onXRangeChange([t0, t1]);
      } else {
        onXRangeChange([r0 as number, r1 as number]);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-xs font-sans"
           style={{ color: 'var(--sp-text-tertiary)' }}>
        <span className="animate-pulse">Generating spectrogram…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-xs font-sans text-red-400 text-center px-4">
        ⚠ {error}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div>
      {result.downsampled && (
        <p className="text-[10px] font-sans text-amber-500 mb-1 px-1">
          ⚠ Downsampled to 2000 time bins for display performance
        </p>
      )}
      <Plot
        data={traces}
        layout={layout}
        useResizeHandler
        style={{ width: '100%', height: '320px' }}
        config={{
          displayModeBar: true,
          modeBarButtonsToRemove: ['select2d', 'lasso2d'] as Plotly.ModeBarDefaultButtons[],
          displaylogo: false,
        }}
        onRelayout={handleRelayout}
      />
    </div>
  );
}
