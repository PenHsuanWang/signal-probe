import { useCallback, useEffect, useRef, useState } from 'react';
import { Plot } from '../lib/plot';
import { Activity, UploadCloud, CheckCircle, Clock, XCircle, RefreshCw } from 'lucide-react';
import FileUploader from '../components/FileUploader';
import { listSignals, getMacroView, getRunChunks } from '../lib/api';
import type { MacroViewResponse, RunBound, RunChunkResponse, SignalMetadata } from '../types/signal';

// ── Shared Plotly layout base ────────────────────────────────────────────────
const LAYOUT_BASE = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { family: 'JetBrains Mono, monospace', color: '#a1a1aa', size: 11 },
  margin: { t: 8, r: 12, l: 48, b: 36 },
  xaxis: { gridcolor: '#27272a', zerolinecolor: '#3f3f46', color: '#71717a' },
  yaxis: { gridcolor: '#27272a', zerolinecolor: '#3f3f46', color: '#71717a' },
  showlegend: false,
  hovermode: 'x unified',
} as const;

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: SignalMetadata['status'] }) {
  const cfgMap = {
    PENDING: { color: 'text-zinc-400', label: 'PENDING', spin: false },
    PROCESSING: { color: 'text-blue-400', label: 'PROCESSING', spin: true },
    COMPLETED: { color: 'text-green-400', label: 'COMPLETED', spin: false },
    FAILED: { color: 'text-red-400', label: 'FAILED', spin: false },
  };
  const cfg = cfgMap[status];
  const icons = {
    PENDING: <Clock size={12} />,
    PROCESSING: <RefreshCw size={12} className="animate-spin" />,
    COMPLETED: <CheckCircle size={12} />,
    FAILED: <XCircle size={12} />,
  };
  return (
    <span className={`flex items-center space-x-1 text-xs font-mono ${cfg.color}`}>
      {icons[status]}
      <span>{cfg.label}</span>
    </span>
  );
}

// ── Single run micro-chart ────────────────────────────────────────────────────
interface MicroChartProps {
  run: RunChunkResponse;
  onInitialized: (runId: string, div: HTMLDivElement) => void;
  onHover: (xFraction: number) => void;
  onUnhover: () => void;
}

function MicroChart({ run, onInitialized, onHover, onUnhover }: MicroChartProps) {
  const oocX = run.x.filter((_, i) => run.states[i] === 'OOC');
  const oocY = run.y.filter((_, i) => run.states[i] === 'OOC');
  const xMax = run.x.length > 0 ? run.x[run.x.length - 1] : 1;

  const traces = [
    {
      x: run.x, y: run.y,
      type: 'scattergl', mode: 'lines',
      line: { color: '#3b82f6', width: 1.5 },
    },
    ...(oocX.length > 0 ? [{
      x: oocX, y: oocY,
      type: 'scattergl', mode: 'markers',
      marker: { color: '#ef4444', size: 5 },
    }] : []),
  ];

  const layout = {
    ...LAYOUT_BASE,
    margin: { t: 26, r: 8, l: 42, b: 28 },
    title: {
      text: `RUN_${String(run.run_index + 1).padStart(2, '0')}${run.ooc_count > 0 ? ` ⚠${run.ooc_count}` : ''}`,
      font: { size: 10, color: run.ooc_count > 0 ? '#ef4444' : '#a1a1aa', family: 'JetBrains Mono, monospace' },
      x: 0.04,
    },
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-1">
      <Plot
        data={traces as Plotly.Data[]}
        layout={layout as Partial<Plotly.Layout>}
        useResizeHandler
        style={{ width: '100%', height: '180px' }}
        config={{ displayModeBar: false }}
        onInitialized={(_fig, graphDiv) =>
          onInitialized(run.run_id, graphDiv as HTMLDivElement)
        }
        onHover={(e) => {
          const pt = e.points?.[0];
          if (pt) onHover((pt.x as number) / (xMax || 1));
        }}
        onUnhover={onUnhover}
      />
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [signals, setSignals] = useState<SignalMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [macroData, setMacroData] = useState<MacroViewResponse | null>(null);
  const [runChunks, setRunChunks] = useState<RunChunkResponse[]>([]);
  const [loadingMacro, setLoadingMacro] = useState(false);
  const [macroError, setMacroError] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [showUploader, setShowUploader] = useState(false);

  const plotDivs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch signal list ──────────────────────────────────────────────────────
  const refreshSignals = useCallback(async () => {
    try {
      setSignals(await listSignals());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshSignals(); }, [refreshSignals]);

  // ── Poll processing signals every 2 s ─────────────────────────────────────
  // Track whether any signal still needs polling (via ref to avoid restarting
  // the stable interval on every signals state update).
  const needsPollRef = useRef(false);
  useEffect(() => {
    needsPollRef.current = signals.some(
      (s) => s.status === 'PENDING' || s.status === 'PROCESSING'
    );
  }, [signals]);

  useEffect(() => {
    const id = setInterval(() => {
      if (needsPollRef.current) refreshSignals();
    }, 2000);
    pollingRef.current = id;
    return () => { clearInterval(id); pollingRef.current = null; };
  }, [refreshSignals]);

  // ── Load macro view on signal selection ───────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setMacroData(null); setRunChunks([]); setMacroError(false); return; }
    const sig = signals.find((s) => s.id === selectedId);
    if (!sig || sig.status !== 'COMPLETED') { setMacroData(null); setRunChunks([]); setMacroError(false); return; }
    setLoadingMacro(true);
    setMacroError(false);
    getMacroView(selectedId)
      .then((data) => { setMacroData(data); setMacroError(false); })
      .catch(() => { setMacroData(null); setMacroError(true); })
      .finally(() => setLoadingMacro(false));
  }, [selectedId, signals]);

  // ── Brush selection → load run chunks ─────────────────────────────────────
  const handleMacroRelayout = useCallback(
    async (event: Plotly.PlotRelayoutEvent) => {
      if (!macroData || !selectedId) return;
      const ev = event as unknown as Record<string, unknown>;
      const x0 = ev['xaxis.range[0]'] as number | undefined;
      const x1 = ev['xaxis.range[1]'] as number | undefined;
      if (x0 === undefined || x1 === undefined) return;
      const visible: RunBound[] = macroData.runs.filter(
        (r) => r.start_x < x1 && r.end_x > x0
      );
      if (!visible.length) { setRunChunks([]); return; }
      setLoadingRuns(true);
      plotDivs.current.clear();
      try {
        setRunChunks(await getRunChunks(selectedId, visible.map((r) => r.run_id)));
      } finally { setLoadingRuns(false); }
    },
    [macroData, selectedId]
  );

  // ── Synchronized crosshairs via direct Plotly.relayout ────────────────────
  const handleMicroHover = useCallback((xFraction: number) => {
    const P = (window as unknown as { Plotly?: { relayout: (div: HTMLDivElement, update: object) => void } }).Plotly;
    if (!P) return;
    plotDivs.current.forEach((div, runId) => {
      const run = runChunks.find((r) => r.run_id === runId);
      if (!run || !run.x.length) return;
      const absX = xFraction * run.x[run.x.length - 1];
      P.relayout(div, {
        shapes: [{
          type: 'line', x0: absX, x1: absX, y0: 0, y1: 1,
          xref: 'x', yref: 'paper',
          line: { color: '#ef4444', width: 1, dash: 'dot' },
        }],
      });
    });
  }, [runChunks]);

  const handleMicroUnhover = useCallback(() => {
    const P = (window as unknown as { Plotly?: { relayout: (div: HTMLDivElement, update: object) => void } }).Plotly;
    if (!P) return;
    plotDivs.current.forEach((div) => P.relayout(div, { shapes: [] }));
  }, []);

  // ── Macro layout ───────────────────────────────────────────────────────────
  const macroShapes = macroData?.runs.map((r) => ({
    type: 'rect' as const,
    xref: 'x' as const, yref: 'paper' as const,
    x0: r.start_x, x1: r.end_x, y0: 0, y1: 1,
    fillcolor: r.ooc_count > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)',
    line: { width: 0 },
    layer: 'below' as const,
  })) ?? [];

  const macroTraces: Plotly.Data[] = macroData ? [
    { x: macroData.x, y: macroData.y, type: 'scattergl', mode: 'lines', line: { color: '#3b82f6', width: 1 } } as Plotly.Data,
    ...(macroData.states.some((s) => s === 'OOC') ? [{
      x: macroData.x.filter((_, i) => macroData.states[i] === 'OOC'),
      y: macroData.y.filter((_, i) => macroData.states[i] === 'OOC'),
      type: 'scattergl', mode: 'markers',
      marker: { color: '#ef4444', size: 4 },
    } as Plotly.Data] : []),
  ] : [];

  const macroLayout: Partial<Plotly.Layout> = {
    ...LAYOUT_BASE,
    margin: { t: 8, r: 12, l: 52, b: 60 },
    shapes: macroShapes as Plotly.Shape[],
    xaxis: {
      ...LAYOUT_BASE.xaxis,
      rangeslider: { visible: true, thickness: 0.08, bgcolor: '#18181b', bordercolor: '#3f3f46', borderwidth: 1 },
    },
  };

  const selectedSignal = signals.find((s) => s.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Signal list */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest">MY_SIGNALS</h2>
          <button
            onClick={() => setShowUploader((v) => !v)}
            className="flex items-center space-x-1.5 text-xs font-mono text-brand-400 hover:text-brand-300 transition-colors"
          >
            <UploadCloud size={13} />
            <span>{showUploader ? 'Cancel' : 'Upload New'}</span>
          </button>
        </div>

        {showUploader && (
          <div className="mb-4">
            <FileUploader onUploadComplete={(s) => { setSignals((p) => [s, ...p]); setShowUploader(false); setSelectedId(s.id); }} />
          </div>
        )}

        {signals.length === 0 ? (
          <p className="text-xs font-mono text-zinc-600 py-2">
            No signals yet — upload a CSV or Parquet file.
          </p>
        ) : (
          <div className="space-y-1">
            {signals.map((s) => (
              <button
                key={s.id}
                disabled={s.status !== 'COMPLETED'}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded text-xs font-mono transition-colors
                  ${selectedId === s.id
                    ? 'bg-brand-500/15 border border-brand-500/30 text-zinc-100'
                    : s.status === 'COMPLETED'
                      ? 'hover:bg-zinc-800 text-zinc-300 border border-transparent cursor-pointer'
                      : 'opacity-50 text-zinc-500 border border-transparent cursor-default'
                  }`}
              >
                <span className="truncate max-w-[55%]">{s.original_filename}</span>
                <div className="flex items-center space-x-3 flex-shrink-0">
                  {s.status === 'COMPLETED' && (
                    <span className="text-zinc-600">
                      {s.active_run_count}r · {s.ooc_count} OOC
                    </span>
                  )}
                  <StatusBadge status={s.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Macro timeline */}
      {selectedId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest">MACRO_VIEW</h2>
              <p className="text-xs font-mono text-zinc-600 mt-0.5">
                LTTB-downsampled · drag rangeslider to load runs
                {macroData && ` · ${macroData.runs.length} runs`}
              </p>
            </div>
            {macroData && (
              <div className="flex items-center space-x-3 text-xs font-mono text-zinc-500">
                <span className="flex items-center space-x-1">
                  <span className="w-3 h-2 rounded-sm inline-block bg-green-500/25 border border-green-500/40" />
                  <span>ACTIVE</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-3 h-2 rounded-sm inline-block bg-red-500/20 border border-red-500/40" />
                  <span>OOC</span>
                </span>
              </div>
            )}
          </div>

          {loadingMacro ? (
            <div className="h-64 flex items-center justify-center text-zinc-500 font-mono text-xs">
              <Activity size={14} className="animate-spin mr-2" /> Loading…
            </div>
          ) : !macroData ? (
            <div className="h-64 flex items-center justify-center text-zinc-600 font-mono text-xs">
              {selectedSignal?.status === 'PROCESSING' && '⏳ Processing — please wait…'}
              {selectedSignal?.status === 'PENDING' && '⏳ Queued for processing…'}
              {selectedSignal?.status === 'FAILED' && `✗ Failed: ${selectedSignal.error_message ?? 'unknown error'}`}
              {selectedSignal?.status === 'COMPLETED' && macroError && (
                <span className="flex flex-col items-center space-y-2">
                  <span className="text-red-400">⚠ Could not load macro view</span>
                  <button
                    onClick={() => {
                      setMacroError(false);
                      setLoadingMacro(true);
                      getMacroView(selectedId!)
                        .then((data) => { setMacroData(data); setMacroError(false); })
                        .catch(() => { setMacroData(null); setMacroError(true); })
                        .finally(() => setLoadingMacro(false));
                    }}
                    className="text-brand-400 hover:text-brand-300 underline"
                  >
                    Retry
                  </button>
                </span>
              )}
            </div>
          ) : (
            <Plot
              data={macroTraces}
              layout={macroLayout}
              useResizeHandler
              style={{ width: '100%', height: '260px' }}
              config={{ displayModeBar: false }}
              onRelayout={handleMacroRelayout}
            />
          )}
        </div>
      )}

      {/* Micro grid */}
      {runChunks.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="mb-3">
            <h2 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest">MICRO_GRID</h2>
            <p className="text-xs font-mono text-zinc-600 mt-0.5">
              {runChunks.length} run{runChunks.length !== 1 ? 's' : ''} · hover to sync crosshairs ·
              <span className="text-red-500"> ⚠ OOC anomalies in red</span>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {runChunks.map((run) => (
              <MicroChart
                key={run.run_id}
                run={run}
                onInitialized={(id, div) => plotDivs.current.set(id, div)}
                onHover={handleMicroHover}
                onUnhover={handleMicroUnhover}
              />
            ))}
          </div>
        </div>
      )}

      {loadingRuns && (
        <div className="flex items-center justify-center py-6 text-zinc-500 font-mono text-xs">
          <Activity size={13} className="animate-spin mr-2" /> Loading run data…
        </div>
      )}

      {!selectedId && signals.length > 0 && (
        <p className="text-center text-zinc-600 font-mono text-xs py-8">
          Select a completed signal above to explore its waveforms.
        </p>
      )}

      {signals.length === 0 && !showUploader && (
        <div className="text-center py-16 space-y-3">
          <Activity size={40} className="text-zinc-700 mx-auto" />
          <p className="font-mono text-zinc-500 text-sm">No signals yet.</p>
          <button
            onClick={() => setShowUploader(true)}
            className="inline-flex items-center space-x-2 text-sm font-mono text-brand-400 hover:text-brand-300 transition-colors"
          >
            <UploadCloud size={15} />
            <span>Upload your first signal</span>
          </button>
        </div>
      )}
    </div>
  );
}
