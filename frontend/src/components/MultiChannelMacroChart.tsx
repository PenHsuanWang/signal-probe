import { useCallback, useMemo } from 'react';
import { Plot } from '../lib/plot';
import type { MacroViewResponse, RunBound } from '../types/signal';
import { buildChartTheme, OOC_MARKER } from '../lib/chartTheme';
import type { Theme } from '../context/ThemeContext';

/** Single high-contrast dark-blue used for all channel lines. */
const SERIES_COLOR = '#1a3a6b';

/** Vertical inset (in paper-space units) for top-left panel title annotations. */
const ANNOTATION_VERTICAL_INSET = 0.005;

const GAP = 0.03;

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
 *
 * When ``macro.t0_epoch_s`` is set (temporal time column), the shared x-axis
 * values are converted to ISO date strings so that Plotly renders actual
 * calendar dates and times.  Otherwise elapsed seconds are shown.
 */
export default function MultiChannelMacroChart({ macro, visibleChannels, theme, onRelayout }: Props) {
  const hasDateAxis = macro.t0_epoch_s != null;

  const channels = useMemo(
    () => macro.channels.filter((ch) => visibleChannels.has(ch.channel_name)),
    [macro.channels, visibleChannels],
  );

  const toXValue = useCallback(
    (s: number): number | string =>
      hasDateAxis
        ? new Date((macro.t0_epoch_s! + s) * 1000).toISOString()
        : s,
    [hasDateAxis, macro.t0_epoch_s],
  );

  const xValues = useMemo(() => macro.x.map(toXValue), [macro.x, toXValue]);

  const domains = useMemo((): [number, number][] => {
    const n = channels.length;
    const panelH = n > 0 ? (1 - GAP * (n - 1)) / n : 1;
    return channels.map((_, i) => {
      const top = 1 - i * (panelH + GAP);
      const bottom = top - panelH;
      return [Math.max(0, bottom), Math.min(1, top)];
    });
  }, [channels]);

  const traces = useMemo((): Plotly.Data[] =>
    channels.flatMap((ch, i) => {
      const yaxisKey = i === 0 ? 'y' : `y${i + 1}`;
      const oocX = xValues.filter((_, j) => ch.states[j] === 'OOC');
      const oocY = ch.y.filter((_, j) => ch.states[j] === 'OOC');
      return [
        {
          x: xValues, y: ch.y, type: 'scattergl', mode: 'lines',
          name: ch.channel_name, xaxis: 'x', yaxis: yaxisKey,
          line: { color: SERIES_COLOR, width: 1.5 },
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
    }),
    [channels, xValues],
  );

  const layout = useMemo((): Partial<Plotly.Layout> => {
    const N = channels.length;
    const isLight = theme === 'light';
    const base = buildChartTheme(theme);

    const innerShapes: Partial<Plotly.Shape>[] = macro.runs.flatMap((r: RunBound) =>
      channels.map((_, i) => ({
        type: 'rect' as const,
        xref: 'x' as const,
        yref: (i === 0 ? 'y domain' : `y${i + 1} domain`) as Plotly.Shape['yref'],
        x0: toXValue(r.start_x), x1: toXValue(r.end_x),
        y0: 0, y1: 1,
        fillcolor: r.ooc_count > 0
          ? 'rgba(214,39,40,0.08)'
          : 'rgba(44,160,44,0.06)',
        line: { width: 0 },
        layer: 'below' as const,
      }))
    );

    // Thin solid border drawn around each panel's paper-space bounding box.
    const borderColor = isLight ? '#1a1a1a' : '#4b5563';
    const borderShapes: Partial<Plotly.Shape>[] = channels.map((_, i) => ({
      type: 'rect' as const,
      xref: 'paper' as const,
      yref: 'paper' as const,
      x0: 0, x1: 1,
      y0: domains[i][0], y1: domains[i][1],
      fillcolor: 'rgba(0,0,0,0)',
      line: { width: 1, color: borderColor },
      layer: 'above' as const,
    }));

    const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
    const gridColor = isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
    const sliderBg = isLight ? '#f1f3f5' : '#18181b';
    const sliderBorder = isLight ? '#dee2e6' : '#3f3f46';

    // Channel-name annotations placed just inside the top-left corner of each panel.
    const annotations: Partial<Plotly.Annotations>[] = channels.map((ch, i) => ({
      text: ch.channel_name,
      x: 0.01,
      y: domains[i][1] - ANNOTATION_VERTICAL_INSET,
      xref: 'paper' as const,
      yref: 'paper' as const,
      xanchor: 'left' as const,
      yanchor: 'top' as const,
      showarrow: false,
      font: {
        size: 11,
        family: 'Inter, ui-sans-serif, sans-serif',
        color: axisColor,
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l: Record<string, any> = {
      ...base,
      margin: { t: 8, r: 16, l: 56, b: 60 },
      shapes: [...borderShapes, ...innerShapes],
      annotations,
      xaxis: {
        ...base.xaxis,
        domain: [0, 1],
        anchor: N > 1 ? `y${N}` : 'y',
        color: axisColor,
        gridcolor: gridColor,
        showgrid: true,
        griddash: 'dash',
        tickangle: -45,
        // Use Plotly's 'date' axis type when absolute datetime values are provided;
        // otherwise fall back to the default linear axis for elapsed seconds.
        ...(hasDateAxis ? { type: 'date' } : {}),
        title: {
          text: hasDateAxis ? 'Date / Time' : 'Elapsed (s)',
          font: { size: 12, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        },
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
      const axKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
      l[axKey] = {
        domain: domains[i],
        anchor: 'x',
        color: axisColor,
        gridcolor: gridColor,
        showgrid: true,
        griddash: 'dash',
        zerolinecolor: isLight ? '#1a1a1a' : '#6b7280',
        ticks: 'inside',
        ticklen: 4,
        tickcolor: axisColor,
        tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        linecolor: isLight ? '#1a1a1a' : '#4b5563',
        linewidth: 1,
        showline: true,
        mirror: true,
        title: {
          text: macro.channel_units?.[ch.channel_name] ?? '',
          font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        },
      };
    });

    return l as Partial<Plotly.Layout>;
  }, [channels, domains, macro.runs, hasDateAxis, toXValue, theme]);

  const height = Math.max(220, channels.length * 140 + 80);

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
