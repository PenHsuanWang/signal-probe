import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Plot } from '../lib/plot';
import { buildChartTheme } from '../lib/chartTheme';
import { useSTFTExplorer } from '../hooks/useSTFTExplorer';
import FFTSpectrumChart from './FFTSpectrumChart';
import SpectrogramChart from './SpectrogramChart';
import STFTParamControls from './STFTParamControls';
import type { MacroViewResponse } from '../types/signal';
import type { Theme } from '../context/ThemeContext';

interface Props {
  signalId: string;
  channelNames: string[];
  macroData: MacroViewResponse;
  theme: Theme;
  xRange: [number, number] | null;
  onXRangeChange: (r: [number, number] | null) => void;
}

export default function STFTExplorerPanel({
  signalId,
  channelNames,
  macroData,
  theme,
  xRange,
  onXRangeChange,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  // When the signal has an absolute start time, use a date axis (same as
  // MultiChannelMacroChart) so both charts display the same x-axis format.
  const hasDateAxis = macroData.t0_epoch_s != null;
  const t0 = macroData.t0_epoch_s ?? 0;

  const toDateStr = useCallback(
    (elapsedS: number) => new Date((t0 + elapsedS) * 1000).toISOString(),
    [t0],
  );
  const fromDateStr = useCallback(
    (d: string | number) => new Date(String(d)).getTime() / 1000 - t0,
    [t0],
  );

  const {
    state,
    windowSize,
    samplingRateHz,
    hopSize,
    selectChannel,
    handleBrushSelect,
    clearBrush,
    lockWindow,
    unlockWindow,
    setWindowFn,
    setOverlapPct,
    generateSpectrogram,
  } = useSTFTExplorer(signalId, macroData.x, channelNames[0]);

  // Auto-select first channel if none selected
  const activeChannel = state.channel ?? channelNames[0] ?? null;
  const channelData = useMemo(
    () => macroData.channels.find((c) => c.channel_name === activeChannel),
    [macroData.channels, activeChannel],
  );

  const isLight = theme === 'light';
  const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
  const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

  const explorationTraces = useMemo((): Plotly.Data[] => {
    if (!channelData) return [];
    const xValues = hasDateAxis ? macroData.x.map(toDateStr) : macroData.x;
    return [
      {
        x: xValues,
        y: channelData.y,
        type: 'scattergl',
        mode: 'lines+markers',
        name: activeChannel ?? '',
        line: { color: '#3b82f6', width: 1 },
        marker: { size: 4, opacity: 0, color: '#3b82f6' },
        selected: { marker: { color: '#f59e0b', opacity: 0.7, size: 5 } },
        unselected: { marker: { opacity: 0 } },
      } as Plotly.Data,
    ];
  }, [channelData, macroData.x, activeChannel, hasDateAxis, toDateStr]);

  const brushShape = useMemo((): Partial<Plotly.Shape>[] => {
    if (!state.window) return [];
    return [
      {
        type: 'rect',
        x0: hasDateAxis ? toDateStr(state.window.start_s) : state.window.start_s,
        x1: hasDateAxis ? toDateStr(state.window.end_s) : state.window.end_s,
        y0: 0,
        y1: 1,
        xref: 'x',
        yref: 'paper',
        fillcolor: 'rgba(251,191,36,0.10)',
        line: { color: '#fbbf24', width: 1 },
        layer: 'above',
      },
    ];
  }, [state.window, hasDateAxis, toDateStr]);

  const explorationLayout = useMemo((): Partial<Plotly.Layout> => {
    const base = buildChartTheme(theme);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l: Record<string, any> = {
      ...base,
      dragmode: 'select',
      margin: { t: 8, r: 12, l: 52, b: 44 },
      shapes: brushShape as Plotly.Shape[],
      selectdirection: 'h',
      xaxis: {
        ...(hasDateAxis ? { type: 'date' } : {}),
        color: axisColor,
        gridcolor: gridColor,
        title: {
          text: hasDateAxis ? 'Date / Time' : 'Time (s)',
          font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        },
        tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        ticks: 'inside',
        tickcolor: axisColor,
        linecolor: axisColor,
        linewidth: 1,
        showline: true,
        ...(xRange && hasDateAxis
          ? { range: [toDateStr(xRange[0]), toDateStr(xRange[1])] }
          : xRange ? { range: xRange } : {}),
      },
      yaxis: {
        color: axisColor,
        gridcolor: gridColor,
        tickfont: { size: 9, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        ticks: 'inside',
        tickcolor: axisColor,
        linecolor: axisColor,
        linewidth: 1,
        showline: true,
      },
    };
    return l as Partial<Plotly.Layout>;
  }, [theme, brushShape, axisColor, gridColor, xRange, hasDateAxis, toDateStr]);

  const handleSelected = useCallback(
    (event: Readonly<Plotly.PlotSelectionEvent>) => {
      const rx = event?.range?.x;
      if (!rx || rx.length < 2) return;
      // When the x-axis is a date axis, Plotly returns ISO strings; convert back
      // to elapsed seconds before passing to the backend.
      const start = hasDateAxis ? fromDateStr(rx[0]) : Number(rx[0]);
      const end = hasDateAxis ? fromDateStr(rx[1]) : Number(rx[1]);
      if (isNaN(start) || isNaN(end) || end <= start) return;
      if (state.channel === null && channelNames[0]) {
        selectChannel(channelNames[0]);
      }
      handleBrushSelect(start, end);
    },
    [state.channel, channelNames, selectChannel, handleBrushSelect],
  );

  const handleDeselect = useCallback(() => {
    clearBrush();
  }, [clearBrush]);

  const handleExplorationRelayout = useCallback(
    (event: Plotly.PlotRelayoutEvent) => {
      const ev = event as unknown as Record<string, unknown>;
      const r0 = ev['xaxis.range[0]'];
      const r1 = ev['xaxis.range[1]'];
      if (r0 !== undefined && r1 !== undefined) {
        // Date axis: Plotly returns ISO strings; convert back to elapsed seconds.
        const x0 = hasDateAxis ? fromDateStr(r0 as string) : Number(r0);
        const x1 = hasDateAxis ? fromDateStr(r1 as string) : Number(r1);
        if (!isNaN(x0) && !isNaN(x1)) {
          onXRangeChange([x0, x1]);
        }
      }
    },
    [onXRangeChange, hasDateAxis, fromDateStr],
  );

  const totalDuration =
    macroData.x.length > 1 ? macroData.x[macroData.x.length - 1] - macroData.x[0] : 0;

  const infoBarText = useMemo(() => {
    if (!state.window || !windowSize) return null;
    const dur = (state.window.end_s - state.window.start_s).toFixed(3);
    const samples = Math.round(
      (state.window.end_s - state.window.start_s) * samplingRateHz,
    );
    return `Selection: ${dur} s · ${samples.toLocaleString()} samples · window_size → ${windowSize}`;
  }, [state.window, windowSize, samplingRateHz]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none"
        style={{ borderBottom: collapsed ? undefined : '1px solid var(--sp-border)' }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>
          STFT Parameter Exploration
        </span>
        <button
          aria-label={collapsed ? 'Expand STFT panel' : 'Collapse STFT panel'}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          {/* Channel selector */}
          <div className="flex items-center gap-3">
            <label className="text-[10px] font-sans font-semibold uppercase tracking-wide flex-shrink-0"
                   style={{ color: 'var(--sp-text-tertiary)' }}>
              Channel
            </label>
            <select
              aria-label="Select channel for STFT exploration"
              value={activeChannel ?? ''}
              onChange={(e) => selectChannel(e.target.value)}
              className="rounded text-xs font-sans px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-all"
              style={{
                background: 'var(--sp-surface-primary)',
                border: '1px solid var(--sp-border)',
                color: 'var(--sp-text-primary)',
              }}
            >
              {channelNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {/* Exploration chart */}
          <div>
            <Plot
              data={explorationTraces}
              layout={explorationLayout}
              useResizeHandler
              style={{ width: '100%', height: '200px' }}
              config={{
                displayModeBar: true,
                modeBarButtonsToRemove: [
                  'zoom2d', 'pan2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d',
                  'autoScale2d', 'hoverClosestCartesian', 'hoverCompareCartesian',
                  'toggleSpikelines',
                ] as Plotly.ModeBarDefaultButtons[],
                displaylogo: false,
              }}
              onSelected={handleSelected}
              onDeselect={handleDeselect}
              onRelayout={handleExplorationRelayout}
            />

            {/* Info bar */}
            {infoBarText && (
              <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--sp-text-tertiary)' }}>
                {infoBarText}
              </p>
            )}
          </div>

          {/* FFT Spectrum + Param Controls side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              className="rounded p-3 min-h-[220px]"
              style={{ background: 'var(--sp-surface-primary)', border: '1px solid var(--sp-border)' }}
            >
              <h3 className="text-[10px] font-sans font-semibold uppercase tracking-wide mb-2"
                  style={{ color: 'var(--sp-text-tertiary)' }}>
                FFT Spectrum
              </h3>
              <FFTSpectrumChart
                result={state.fftResult}
                loading={state.fftLoading}
                error={state.fftError}
                theme={theme}
              />
            </div>

            <div
              className="rounded p-3 min-h-[220px]"
              style={{ background: 'var(--sp-surface-primary)', border: '1px solid var(--sp-border)' }}
            >
              <h3 className="text-[10px] font-sans font-semibold uppercase tracking-wide mb-2"
                  style={{ color: 'var(--sp-text-tertiary)' }}>
                STFT Parameters
              </h3>
              <STFTParamControls
                phase={state.phase}
                windowFn={state.windowFn}
                windowSize={windowSize}
                lockedWindowSize={state.lockedWindowSize}
                overlapPct={state.overlapPct}
                hopSize={hopSize}
                samplingRateHz={samplingRateHz}
                totalDuration={totalDuration}
                spectrogramLoading={state.spectrogramLoading}
                onSetWindowFn={setWindowFn}
                onLockWindow={lockWindow}
                onUnlockWindow={unlockWindow}
                onSetOverlapPct={setOverlapPct}
                onGenerateSpectrogram={generateSpectrogram}
              />
            </div>
          </div>

          {/* Spectrogram */}
          {(state.phase === 'generating' || state.phase === 'spectrogram_ready') && (
            <div
              className="rounded p-3"
              style={{ background: 'var(--sp-surface-primary)', border: '1px solid var(--sp-border)' }}
            >
              <h3 className="text-[10px] font-sans font-semibold uppercase tracking-wide mb-2"
                  style={{ color: 'var(--sp-text-tertiary)' }}>
                Spectrogram (Viridis · dBFS)
              </h3>
              <SpectrogramChart
                result={state.spectrogramResult}
                loading={state.spectrogramLoading}
                error={state.spectrogramError}
                theme={theme}
                t0EpochS={macroData.t0_epoch_s}
                brushWindow={state.window}
                xRange={xRange}
                onXRangeChange={(r) => onXRangeChange(r)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
