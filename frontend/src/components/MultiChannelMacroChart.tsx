import { useMemo } from 'react';
import { Plot } from '../lib/plot';
import type { MacroViewResponse, RunBound } from '../types/signal';

const CH_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];
const chColor = (i: number) => CH_COLORS[i % CH_COLORS.length];

interface Props {
  macro: MacroViewResponse;
  visibleChannels: Set<string>;
  onRelayout: (event: Plotly.PlotRelayoutEvent) => void;
}

/**
 * Stacked multi-panel macro chart.
 *
 * Each visible channel occupies its own horizontal subplot row, all sharing
 * a single x-axis.  Hovering over any panel draws a spike line across all
 * panels, and the unified tooltip shows every channel's value at that
 * timestamp.  A rangeslider at the bottom drives the run-chunk brush event.
 */
export default function MultiChannelMacroChart({ macro, visibleChannels, onRelayout }: Props) {
  const channels = macro.channels.filter((ch) => visibleChannels.has(ch.channel_name));
  const N = channels.length;

  // Compute equally-spaced vertical domains for each panel (top → bottom).
  const GAP = 0.03;
  const panelH = N > 0 ? (1 - GAP * (N - 1)) / N : 1;
  const domains: [number, number][] = channels.map((_, i) => {
    const top = 1 - i * (panelH + GAP);
    const bottom = top - panelH;
    return [Math.max(0, bottom), Math.min(1, top)];
  });

  // Traces: all share xaxis 'x', each channel gets its own yaxis slot.
  const traces: Plotly.Data[] = channels.flatMap((ch, i) => {
    const origIdx = macro.channels.findIndex((c) => c.channel_name === ch.channel_name);
    const color = chColor(origIdx);
    const yaxisKey = i === 0 ? 'y' : `y${i + 1}`;
    const oocX = macro.x.filter((_, j) => ch.states[j] === 'OOC');
    const oocY = ch.y.filter((_, j) => ch.states[j] === 'OOC');
    return [
      {
        x: macro.x, y: ch.y, type: 'scattergl', mode: 'lines',
        name: ch.channel_name, xaxis: 'x', yaxis: yaxisKey,
        line: { color, width: 1 },
        hovertemplate: `%{y:.3f}<extra>${ch.channel_name}</extra>`,
      } as Plotly.Data,
      ...(oocX.length > 0 ? [{
        x: oocX, y: oocY, type: 'scattergl', mode: 'markers',
        name: `${ch.channel_name} OOC`, xaxis: 'x', yaxis: yaxisKey,
        showlegend: false, marker: { color: '#ef4444', size: 4 },
        hoverinfo: 'skip',
      } as Plotly.Data] : []),
    ];
  });

  const channelNamesKey = channels.map((c) => c.channel_name).join(',');

  const layout = useMemo((): Partial<Plotly.Layout> => {
    // Run-bound shading — one rect per run per panel.
    const innerShapes: Partial<Plotly.Shape>[] = macro.runs.flatMap((r: RunBound) =>
      channels.map((_, i) => ({
        type: 'rect' as const,
        xref: 'x' as const,
        yref: (i === 0 ? 'y domain' : `y${i + 1} domain`) as Plotly.Shape['yref'],
        x0: r.start_x, x1: r.end_x,
        y0: 0, y1: 1,
        fillcolor: r.ooc_count > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)',
        line: { width: 0 },
        layer: 'below' as const,
      }))
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l: Record<string, any> = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'JetBrains Mono, monospace', color: '#a1a1aa', size: 11 },
      margin: { t: 8, r: 12, l: 52, b: 60 },
      hovermode: 'x unified',
      showlegend: false,
      shapes: innerShapes,
      xaxis: {
        domain: [0, 1],
        anchor: N > 1 ? `y${N}` : 'y',
        gridcolor: '#27272a',
        zerolinecolor: '#3f3f46',
        color: '#71717a',
        showspikes: true,
        spikemode: 'across',
        spikethickness: 1,
        spikecolor: '#71717a',
        spikedash: 'dot',
        rangeslider: {
          visible: true,
          thickness: 0.06,
          bgcolor: '#18181b',
          bordercolor: '#3f3f46',
          borderwidth: 1,
        },
      },
    };

    channels.forEach((ch, i) => {
      const origIdx = macro.channels.findIndex((c) => c.channel_name === ch.channel_name);
      const axKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
      l[axKey] = {
        domain: domains[i],
        anchor: 'x',
        gridcolor: '#27272a',
        zerolinecolor: '#3f3f46',
        color: '#71717a',
        title: {
          text: ch.channel_name,
          font: { size: 9, color: chColor(origIdx) },
          standoff: 4,
        },
        tickfont: { size: 9 },
      };
    });

    return l as Partial<Plotly.Layout>;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelNamesKey, macro.runs, macro.channels]);

  const height = Math.max(200, N * 130 + 70);

  return (
    <Plot
      data={traces}
      layout={layout}
      useResizeHandler
      style={{ width: '100%', height: `${height}px` }}
      config={{ displayModeBar: false }}
      onRelayout={onRelayout}
    />
  );
}
