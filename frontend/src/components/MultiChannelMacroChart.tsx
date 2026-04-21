import { useMemo } from 'react';
import { Plot } from '../lib/plot';
import type { MacroViewResponse, RunBound } from '../types/signal';
import { buildChartTheme, scientificColor, OOC_MARKER } from '../lib/chartTheme';
import type { Theme } from '../context/ThemeContext';

interface Props {
  macro: MacroViewResponse;
  visibleChannels: Set<string>;
  theme: Theme;
  onRelayout: (event: Plotly.PlotRelayoutEvent) => void;
}

/**
 * Stacked multi-panel macro chart.
 *
 * Each visible channel occupies its own horizontal subplot row, all sharing
 * a single x-axis. Hovering over any panel draws a spike line across all
 * panels, and the unified tooltip shows every channel's value at that
 * timestamp. A rangeslider at the bottom drives the run-chunk brush event.
 */
export default function MultiChannelMacroChart({ macro, visibleChannels, theme, onRelayout }: Props) {
  const channels = macro.channels.filter((ch) => visibleChannels.has(ch.channel_name));
  const N = channels.length;

  const GAP = 0.03;
  const panelH = N > 0 ? (1 - GAP * (N - 1)) / N : 1;
  const domains: [number, number][] = channels.map((_, i) => {
    const top = 1 - i * (panelH + GAP);
    const bottom = top - panelH;
    return [Math.max(0, bottom), Math.min(1, top)];
  });

  const traces: Plotly.Data[] = channels.flatMap((ch, i) => {
    const origIdx = macro.channels.findIndex((c) => c.channel_name === ch.channel_name);
    const color = scientificColor(origIdx);
    const yaxisKey = i === 0 ? 'y' : `y${i + 1}`;
    const oocX = macro.x.filter((_, j) => ch.states[j] === 'OOC');
    const oocY = ch.y.filter((_, j) => ch.states[j] === 'OOC');
    return [
      {
        x: macro.x, y: ch.y, type: 'scattergl', mode: 'lines',
        name: ch.channel_name, xaxis: 'x', yaxis: yaxisKey,
        line: { color, width: 1.5 },
        hovertemplate: `%{y:.4g}<extra>${ch.channel_name}</extra>`,
      } as Plotly.Data,
      ...(oocX.length > 0 ? [{
        x: oocX, y: oocY, type: 'scattergl', mode: 'markers',
        name: `${ch.channel_name} OOC`, xaxis: 'x', yaxis: yaxisKey,
        showlegend: false,
        marker: OOC_MARKER,
        hoverinfo: 'skip',
      } as Plotly.Data] : []),
    ];
  });

  const channelNamesKey = channels.map((c) => c.channel_name).join(',');
  const isLight = theme === 'light';

  const layout = useMemo((): Partial<Plotly.Layout> => {
    const base = buildChartTheme(theme);

    const innerShapes: Partial<Plotly.Shape>[] = macro.runs.flatMap((r: RunBound) =>
      channels.map((_, i) => ({
        type: 'rect' as const,
        xref: 'x' as const,
        yref: (i === 0 ? 'y domain' : `y${i + 1} domain`) as Plotly.Shape['yref'],
        x0: r.start_x, x1: r.end_x,
        y0: 0, y1: 1,
        fillcolor: r.ooc_count > 0
          ? 'rgba(214,39,40,0.08)'
          : 'rgba(44,160,44,0.06)',
        line: { width: 0 },
        layer: 'below' as const,
      }))
    );

    const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
    const gridColor = isLight ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.05)';
    const sliderBg = isLight ? '#f1f3f5' : '#18181b';
    const sliderBorder = isLight ? '#dee2e6' : '#3f3f46';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l: Record<string, any> = {
      ...base,
      margin: { t: 8, r: 16, l: 56, b: 60 },
      shapes: innerShapes,
      xaxis: {
        ...base.xaxis,
        domain: [0, 1],
        anchor: N > 1 ? `y${N}` : 'y',
        color: axisColor,
        gridcolor: gridColor,
        title: { text: 'Time (s)', font: { size: 12, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor } },
        showspikes: true,
        spikemode: 'across',
        spikethickness: 1,
        spikecolor: axisColor,
        spikedash: 'dot',
        rangeslider: {
          visible: true,
          thickness: 0.06,
          bgcolor: sliderBg,
          bordercolor: sliderBorder,
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
        color: axisColor,
        gridcolor: gridColor,
        zerolinecolor: isLight ? '#1a1a1a' : '#6b7280',
        ticks: 'inside',
        ticklen: 4,
        tickcolor: axisColor,
        tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        linecolor: isLight ? '#1a1a1a' : '#4b5563',
        linewidth: 1,
        showline: true,
        mirror: isLight,
        title: {
          text: ch.channel_name,
          font: { size: 11, family: 'Inter, ui-sans-serif, sans-serif', color: scientificColor(origIdx) },
          standoff: 6,
        },
      };
    });

    return l as Partial<Plotly.Layout>;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelNamesKey, macro.runs, macro.channels, theme]);

  const height = Math.max(220, N * 140 + 80);

  return (
    <Plot
      data={traces}
      layout={layout}
      useResizeHandler
      style={{ width: '100%', height: `${height}px` }}
      config={{
        displayModeBar: true,
        modeBarButtonsToRemove: [
          'zoom2d', 'pan2d', 'select2d', 'lasso2d',
          'zoomIn2d', 'zoomOut2d', 'autoScale2d',
          'hoverClosestCartesian', 'hoverCompareCartesian',
          'toggleSpikelines',
        ] as Plotly.ModeBarDefaultButtons[],
        displaylogo: false,
        toImageButtonOptions: { format: 'png', scale: 2 },
      }}
      onRelayout={onRelayout}
    />
  );
}
