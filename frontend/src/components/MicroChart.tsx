import { Plot } from '../lib/plot';
import { buildChartTheme, scientificColor } from '../lib/chartTheme';
import type { ChannelChunkData, RunChunkResponse } from '../types/signal';

interface MicroChartProps {
  run: RunChunkResponse;
  visibleChannels: Set<string>;
  theme: 'dark' | 'light';
  onInitialized: (runId: string, div: HTMLDivElement) => void;
  onHover: (xFraction: number) => void;
  onUnhover: () => void;
}

export default function MicroChart({ run, visibleChannels, theme, onInitialized, onHover, onUnhover }: MicroChartProps) {
  const xMax = run.x.length > 0 ? run.x[run.x.length - 1] : 1;

  const traces: Plotly.Data[] = run.channels.flatMap((ch: ChannelChunkData, i: number) => {
    if (!visibleChannels.has(ch.channel_name)) return [];
    const color = scientificColor(i);
    return [
      { x: run.x, y: ch.y, type: 'scattergl', mode: 'lines',
        name: ch.channel_name, line: { color, width: 1.5 } } as Plotly.Data,
    ];
  });

  const isLight = theme === 'light';
  const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
  const gridColor = isLight ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.05)';
  const runLabel = `Run ${String(run.run_index + 1).padStart(2, '0')}`;
  const runTitle = runLabel;

  const layout = {
    ...buildChartTheme(theme),
    margin: { t: 28, r: 8, l: 44, b: 32 },
    showlegend: run.channels.length > 1,
    legend: { font: { size: 9, family: 'Inter, ui-sans-serif, sans-serif' }, bgcolor: 'transparent', x: 1, xanchor: 'right', y: 1 },
    xaxis: {
      color: axisColor, gridcolor: gridColor,
      zerolinecolor: isLight ? '#1a1a1a' : '#6b7280',
      ticks: 'inside' as const, ticklen: 4, tickcolor: axisColor,
      tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
      linecolor: isLight ? '#1a1a1a' : '#4b5563', linewidth: 1, showline: true,
      mirror: isLight,
    },
    yaxis: {
      color: axisColor, gridcolor: gridColor,
      zerolinecolor: isLight ? '#1a1a1a' : '#6b7280',
      ticks: 'inside' as const, ticklen: 4, tickcolor: axisColor,
      tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
      linecolor: isLight ? '#1a1a1a' : '#4b5563', linewidth: 1, showline: true,
      mirror: isLight,
    },
    title: {
      text: runTitle,
      font: {
        size: 11,
        family: 'Inter, ui-sans-serif, sans-serif',
        color: axisColor,
      },
      x: 0.04,
    },
  };

  const cardBg = isLight ? 'bg-white border border-[#dee2e6]' : 'bg-zinc-900 border border-zinc-800';

  return (
    <div className={`rounded p-1 ${cardBg}`}>
      <Plot
        data={traces}
        layout={layout as Partial<Plotly.Layout>}
        useResizeHandler
        style={{ width: '100%', height: '180px' }}
        config={{ displayModeBar: false }}
        onInitialized={(_fig, graphDiv) => onInitialized(run.run_id, graphDiv as HTMLDivElement)}
        onHover={(e) => { const pt = e.points?.[0]; if (pt) onHover((pt.x as number) / (xMax || 1)); }}
        onUnhover={onUnhover}
      />
    </div>
  );
}
