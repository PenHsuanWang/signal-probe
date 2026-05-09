import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Plot } from '../lib/plot';
import { Activity, Waves } from 'lucide-react';
import MicroChart from '../components/MicroChart';
import MultiChannelMacroChart from '../components/MultiChannelMacroChart';
import { useMacroView } from '../hooks/useMacroView';
import { useRunChunks } from '../hooks/useRunChunks';
import { useSignals } from '../context/SignalsContext';
import { useTheme } from '../context/ThemeContext';
import { buildChartTheme, scientificColor, OOC_MARKER } from '../lib/chartTheme';

/**
 * Signal Preview page — /signals/:id
 * Renders the Macro Timeline and Micro Run Grid for a single signal.
 * The selected time window is encoded as ?t0=&t1= URL query params so it
 * is preserved when the user switches to the Analysis tab.
 */
export default function SignalPreviewPage() {
  const { id: signalId } = useParams<{ id: string }>();
  const { signals } = useSignals();
  const { theme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedSignal = signals.find((s) => s.id === signalId);

  // ── URL-driven time window ─────────────────────────────────────────────────
  const t0Raw = searchParams.get('t0');
  const t1Raw = searchParams.get('t1');
  const xRange = useMemo((): [number, number] | null => {
    if (!t0Raw || !t1Raw) return null;
    const t0 = parseFloat(t0Raw);
    const t1 = parseFloat(t1Raw);
    return isNaN(t0) || isNaN(t1) ? null : [t0, t1];
  }, [t0Raw, t1Raw]);

  // ── Data hooks ────────────────────────────────────────────────────────────
  const { macroData, loading: loadingMacro, error: macroError, retry } = useMacroView(signalId ?? null);
  const { runChunks, loading: loadingRuns, error: runError } = useRunChunks(signalId ?? null, xRange, macroData);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(new Set());
  const plotDivs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Initialise channel visibility when macro data arrives
  useEffect(() => {
    if (macroData) {
      setVisibleChannels(new Set(macroData.channels.map((c) => c.channel_name)));
    }
  }, [macroData]);

  // Clear plot div refs when the window changes (new run chunks incoming)
  useEffect(() => {
    plotDivs.current.clear();
  }, [xRange]);

  // ── Brush selection → URL query params ───────────────────────────────────
  const handleMacroRelayout = useCallback(
    (event: Plotly.PlotRelayoutEvent) => {
      if (!macroData) return;
      const ev = event as unknown as Record<string, unknown>;

      let x0: number | undefined;
      let x1: number | undefined;
      if (macroData.t0_epoch_s != null) {
        const r0 = ev['xaxis.range[0]'] as string | undefined;
        const r1 = ev['xaxis.range[1]'] as string | undefined;
        x0 = r0 ? new Date(r0).getTime() / 1000 - macroData.t0_epoch_s : undefined;
        x1 = r1 ? new Date(r1).getTime() / 1000 - macroData.t0_epoch_s : undefined;
      } else {
        x0 = ev['xaxis.range[0]'] as number | undefined;
        x1 = ev['xaxis.range[1]'] as number | undefined;
      }
      if (x0 === undefined || x1 === undefined) return;

      plotDivs.current.clear();
      setSearchParams({ t0: String(x0), t1: String(x1) }, { replace: true });
    },
    [macroData, setSearchParams],
  );

  // ── Synchronized crosshairs ───────────────────────────────────────────────
  const handleMicroHover = useCallback((xFraction: number) => {
    const P = (window as unknown as { Plotly?: { relayout: (div: HTMLDivElement, update: object) => void } }).Plotly;
    if (!P) return;
    plotDivs.current.forEach((div, runId) => {
      const run = runChunks.find((r) => r.run_id === runId);
      if (!run || !run.x.length) return;
      const absX = xFraction * run.x[run.x.length - 1];
      try {
        P.relayout(div, {
          shapes: [{ type: 'line', x0: absX, x1: absX, y0: 0, y1: 1,
            xref: 'x', yref: 'paper', line: OOC_MARKER }],
        });
      } catch { /* unmounted */ }
    });
  }, [runChunks]);

  const handleMicroUnhover = useCallback(() => {
    const P = (window as unknown as { Plotly?: { relayout: (div: HTMLDivElement, update: object) => void } }).Plotly;
    if (!P) return;
    plotDivs.current.forEach((div) => {
      try { P.relayout(div, { shapes: [] }); } catch { /* unmounted */ }
    });
  }, []);

  // ── Chart data / layout ───────────────────────────────────────────────────
  const macroShapes = useMemo(
    () => macroData?.runs.map((r) => ({
      type: 'rect' as const, xref: 'x' as const, yref: 'paper' as const,
      x0: r.start_x, x1: r.end_x, y0: 0, y1: 1,
      fillcolor: 'rgba(34,197,94,0.06)',
      line: { width: 0 }, layer: 'below' as const,
    })) ?? [],
    [macroData?.runs],
  );

  const macroTraces: Plotly.Data[] = macroData
    ? macroData.channels.flatMap((ch, i) => {
        if (!visibleChannels.has(ch.channel_name)) return [];
        const color = scientificColor(i);
        return [{ x: macroData.x, y: ch.y, type: 'scattergl', mode: 'lines',
          name: ch.channel_name, line: { color, width: 1 } } as Plotly.Data];
      })
    : [];

  const macroLayout = useMemo((): Partial<Plotly.Layout> => {
    const isLightMode = theme === 'light';
    const axisColor = isLightMode ? '#1a1a1a' : '#9ca3af';
    const grid = isLightMode ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.05)';
    const slidBg = isLightMode ? '#f5f5f5' : '#18181b';
    const slidBorder = isLightMode ? '#dee2e6' : '#3f3f46';
    return {
      ...buildChartTheme(theme),
      margin: { t: 8, r: 12, l: 52, b: 60 },
      showlegend: (macroData?.channels.length ?? 0) > 1,
      legend: { font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        bgcolor: 'transparent', x: 1, xanchor: 'right', y: 1 },
      shapes: macroShapes as Plotly.Shape[],
      xaxis: {
        color: axisColor, gridcolor: grid, zerolinecolor: axisColor,
        ticks: 'inside', tickcolor: axisColor, linecolor: axisColor, linewidth: 1, showline: true,
        mirror: isLightMode,
        tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        rangeslider: { visible: true, thickness: 0.08, bgcolor: slidBg, bordercolor: slidBorder, borderwidth: 1 },
      },
      yaxis: {
        color: axisColor, gridcolor: grid, zerolinecolor: axisColor,
        ticks: 'inside', tickcolor: axisColor, linecolor: axisColor, linewidth: 1, showline: true,
        mirror: isLightMode,
        tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
      },
    };
  }, [theme, macroShapes, macroData?.channels.length]);

  // ── Analysis tab CTA link (preserves current query params) ────────────────
  const analysisHref = `/signals/${signalId}/analysis${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Macro Timeline */}
      <div className="rounded-lg p-4" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Macro View</h2>
            <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
              All data points · drag rangeslider to load runs
              {macroData && ` · ${macroData.runs.length} runs`}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Channel toggles */}
            {macroData && macroData.channels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end items-center">
                {macroData.channels.map((ch, i) => {
                  const active = visibleChannels.has(ch.channel_name);
                  return (
                    <button
                      key={ch.channel_name}
                      onClick={() => setVisibleChannels((prev) => {
                        const next = new Set(prev);
                        if (active) { if (next.size > 1) next.delete(ch.channel_name); }
                        else next.add(ch.channel_name);
                        return next;
                      })}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-sans transition-opacity ${active ? 'opacity-100' : 'opacity-30'}`}
                      style={{ border: `1px solid ${scientificColor(i)}44`, color: scientificColor(i), backgroundColor: `${scientificColor(i)}11` }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: scientificColor(i) }} />
                      {ch.channel_name}
                    </button>
                  );
                })}
                <div className="flex items-center gap-2 ml-2 text-xs font-mono text-zinc-500">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 rounded-sm inline-block bg-green-500/25 border border-green-500/40" />ACTIVE
                  </span>
                </div>
              </div>
            )}

            {/* CTA: Open in Frequency Analysis */}
            {macroData && (
              <Link
                to={analysisHref}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-sans font-semibold text-brand-400 hover:text-blue-300 border border-brand-500/30 hover:border-brand-500/60 transition-colors flex-shrink-0"
              >
                <Waves size={11} aria-hidden="true" />
                Open in Analysis
              </Link>
            )}
          </div>
        </div>

        {loadingMacro ? (
          <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
            <Activity size={14} className="animate-spin mr-2" /> Loading…
          </div>
        ) : !macroData ? (
          <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
            {selectedSignal?.status === 'PROCESSING' && '⏳ Processing — please wait…'}
            {selectedSignal?.status === 'PENDING' && '⏳ Queued for processing…'}
            {selectedSignal?.status === 'FAILED' && `✗ Failed: ${selectedSignal.error_message ?? 'unknown error'}`}
            {selectedSignal?.status === 'COMPLETED' && macroError && (
              <span className="flex flex-col items-center gap-2">
                <span className="text-red-400">⚠ Could not load macro view</span>
                <button onClick={retry} className="text-brand-400 underline">Retry</button>
              </span>
            )}
            {!selectedSignal && (
              <span className="text-red-400">Signal not found.</span>
            )}
          </div>
        ) : (
          macroData.channels.length > 1 ? (
            <MultiChannelMacroChart
              macro={macroData}
              visibleChannels={visibleChannels}
              theme={theme}
              onRelayout={handleMacroRelayout}
            />
          ) : (
            <Plot data={macroTraces} layout={macroLayout} useResizeHandler
              style={{ width: '100%', height: '260px' }} config={{ displayModeBar: false }}
              onRelayout={handleMacroRelayout}
            />
          )
        )}
      </div>

      {/* Micro Run Grid */}
      {runChunks.length > 0 && (
        <div className="rounded-lg p-4" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
          <div className="mb-3">
            <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Run Grid</h2>
            <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
              {runChunks.length} run{runChunks.length !== 1 ? 's' : ''} · hover to sync crosshairs
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {runChunks.map((run) => (
              <MicroChart
                key={run.run_id}
                run={run}
                visibleChannels={visibleChannels}
                theme={theme}
                onInitialized={(id, div) => plotDivs.current.set(id, div)}
                onHover={handleMicroHover}
                onUnhover={handleMicroUnhover}
              />
            ))}
          </div>
        </div>
      )}

      {loadingRuns && (
        <div className="flex items-center justify-center py-6 font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
          <Activity size={13} className="animate-spin mr-2" /> Loading run data…
        </div>
      )}

      {runError && !loadingRuns && (
        <div className="flex items-center justify-center py-4 font-sans text-xs text-red-400">
          ⚠ Could not load run data — drag the range slider again to retry.
        </div>
      )}
    </div>
  );
}
