import { useCallback, useMemo } from 'react';
import { Plot } from '../lib/plot';
import { buildChartTheme } from '../lib/chartTheme';
import type { MacroViewResponse } from '../types/signal';
import type { Theme } from '../context/ThemeContext';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Macro-level signal data for the channel to display. */
  macro: MacroViewResponse;
  /** Name of the channel to render as a time-domain line. */
  channelName: string;
  /** Window start (seconds from t=0). */
  startS: number;
  /** Window end (seconds from t=0). */
  endS: number;
  /** Active UI theme for Plotly layout. */
  theme: Theme;
  /** Called whenever the user drags / resizes the window region. */
  onWindowChange: (startS: number, endS: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an ISO date string or number to seconds from t=0. */
function toSeconds(
  value: string | number,
  t0EpochS: number | null,
): number {
  if (typeof value === 'number') return value;
  // If t0EpochS is present, value is an ISO date string.
  if (t0EpochS != null) {
    return new Date(value).getTime() / 1000 - t0EpochS;
  }
  return Number(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * TimeSignalWithWindow — renders the time-domain signal for one channel as a
 * Plotly `scattergl` trace, with an **editable** vrect shape overlaid to show
 * the current STFT analysis window.
 *
 * When the user drags or resizes the shape, `onWindowChange(start, end)` is
 * called with new seconds-from-t0 values so the parent hook can trigger a
 * debounced STFT refetch.
 */
export default function TimeSignalWithWindow({
  macro,
  channelName,
  startS,
  endS,
  theme,
  onWindowChange,
}: Props) {
  const hasDateAxis = macro.t0_epoch_s != null;

  // Build x array for the selected channel.
  const xValues = useMemo(() => {
    if (!hasDateAxis) return macro.x;
    return macro.x.map((s) =>
      new Date((macro.t0_epoch_s! + s) * 1000).toISOString(),
    );
  }, [macro.x, macro.t0_epoch_s, hasDateAxis]);

  // Find channel data.
  const channel = useMemo(
    () => macro.channels.find((ch) => ch.channel_name === channelName),
    [macro.channels, channelName],
  );

  // Convert startS / endS to x-axis display units.
  const x0 = useMemo(
    () =>
      hasDateAxis
        ? new Date((macro.t0_epoch_s! + startS) * 1000).toISOString()
        : startS,
    [hasDateAxis, macro.t0_epoch_s, startS],
  );
  const x1 = useMemo(
    () =>
      hasDateAxis
        ? new Date((macro.t0_epoch_s! + endS) * 1000).toISOString()
        : endS,
    [hasDateAxis, macro.t0_epoch_s, endS],
  );

  const handleRelayout = useCallback(
    (evt: Plotly.PlotRelayoutEvent) => {
      // Plotly emits `shapes[N].x0` / `shapes[N].x1` when an editable shape moves.
      const raw = evt as Record<string, unknown>;
      const rawX0 = raw['shapes[0].x0'];
      const rawX1 = raw['shapes[0].x1'];
      if (rawX0 == null || rawX1 == null) return;

      const newStart = toSeconds(rawX0 as string | number, macro.t0_epoch_s);
      const newEnd = toSeconds(rawX1 as string | number, macro.t0_epoch_s);
      if (newStart < newEnd) onWindowChange(newStart, newEnd);
    },
    [macro.t0_epoch_s, onWindowChange],
  );

  const base = buildChartTheme(theme);
  const layout: Partial<Plotly.Layout> = {
    ...base,
    height: 220,
    margin: { t: 8, r: 12, l: 52, b: 44 },
    xaxis: {
      ...(base.xaxis as object),
      title: { text: hasDateAxis ? 'Time' : 'Time (s)', font: { size: 11 } },
      type: hasDateAxis ? 'date' : 'linear',
    },
    yaxis: {
      ...(base.yaxis as object),
      title: { text: channelName, font: { size: 11 } },
    },
    hovermode: 'x',
    shapes: [
      {
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0,
        x1,
        y0: 0,
        y1: 1,
        fillcolor: 'rgba(99,153,237,0.15)',
        line: { color: 'rgba(99,153,237,0.70)', width: 1.5 },
        editable: true,
      } as unknown as Plotly.Shape,
    ],
    dragmode: 'pan' as const,
  };

  if (!channel) {
    return (
      <div
        className="flex items-center justify-center h-[220px] text-xs font-sans"
        style={{ color: 'var(--sp-text-tertiary)' }}
      >
        Channel "{channelName}" not found in macro data.
      </div>
    );
  }

  return (
    <Plot
      data={[
        {
          type: 'scattergl',
          x: xValues,
          y: channel.y,
          mode: 'lines',
          line: { color: '#3b82f6', width: 1.2 },
          name: channelName,
          hovertemplate: '%{y:.4g}<extra></extra>',
        },
      ]}
      layout={layout}
      config={{ responsive: true, displayModeBar: false, editable: true }}
      style={{ width: '100%' }}
      onRelayout={handleRelayout}
    />
  );
}
