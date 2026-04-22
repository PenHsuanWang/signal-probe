import { useCallback, useEffect, useRef, useState } from 'react';
import { Plot } from '../lib/plot';
import {
  Activity, UploadCloud,
  Layers,
} from 'lucide-react';
import FileUploader from '../components/FileUploader';
import MultiChannelMacroChart from '../components/MultiChannelMacroChart';
import StatusBadge from '../components/StatusBadge';
import { getMacroView, getRunChunks, listGroups } from '../lib/api';
import { useSignals } from '../context/SignalsContext';
import { useTheme } from '../context/ThemeContext';
import { buildChartTheme, scientificColor, OOC_MARKER } from '../lib/chartTheme';
import type {
  ChannelChunkData,
  Group,
  GroupMember,
  MacroViewResponse,
  RunBound,
  RunChunkResponse,
} from '../types/signal';

// ── Channel color palette — see chartTheme.ts ────────────────────────────────
// (imported as scientificColor)

// ── Shared Plotly layout base — see buildChartTheme() in lib/chartTheme.ts

// ── Single run micro-chart ────────────────────────────────────────────────────
interface MicroChartProps {
  run: RunChunkResponse;
  visibleChannels: Set<string>;
  theme: 'dark' | 'light';
  onInitialized: (runId: string, div: HTMLDivElement) => void;
  onHover: (xFraction: number) => void;
  onUnhover: () => void;
}

function MicroChart({ run, visibleChannels, theme, onInitialized, onHover, onUnhover }: MicroChartProps) {
  const xMax = run.x.length > 0 ? run.x[run.x.length - 1] : 1;
  const runOocCount = run.channels[0]
    ? run.channels[0].states.filter((s) => s === 'OOC').length
    : run.ooc_count;

  const traces: Plotly.Data[] = run.channels.flatMap((ch: ChannelChunkData, i: number) => {
    if (!visibleChannels.has(ch.channel_name)) return [];
    const color = scientificColor(i);
    const oocX = run.x.filter((_, j) => ch.states[j] === 'OOC');
    const oocY = ch.y.filter((_, j) => ch.states[j] === 'OOC');
    return [
      { x: run.x, y: ch.y, type: 'scattergl', mode: 'lines',
        name: ch.channel_name, line: { color, width: 1.5 } } as Plotly.Data,
      ...(oocX.length > 0 ? [{
        x: oocX, y: oocY, type: 'scattergl', mode: 'markers',
        showlegend: false, marker: OOC_MARKER,
      } as Plotly.Data] : []),
    ];
  });

  const isLight = theme === 'light';
  const axisColor = isLight ? '#1a1a1a' : '#9ca3af';
  const gridColor = isLight ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.05)';
  const runLabel = `Run ${String(run.run_index + 1).padStart(2, '0')}`;
  const runTitle = runOocCount > 0 ? `${runLabel} — ${runOocCount} OOC` : runLabel;

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
        color: runOocCount > 0 ? '#d62728' : axisColor,
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

// ── Group macro result type ───────────────────────────────────────────────────
interface GroupMacroResult {
  signalId: string;
  filename: string;
  member: GroupMember;
  macro: MacroViewResponse;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { signals, refresh } = useSignals();
  const { theme } = useTheme();

  // ── Signal mode state ──────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'signal' | 'group'>('signal');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [macroData, setMacroData] = useState<MacroViewResponse | null>(null);
  const [runChunks, setRunChunks] = useState<RunChunkResponse[]>([]);
  const [loadingMacro, setLoadingMacro] = useState(false);
  const [macroError, setMacroError] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(new Set());

  // ── Group mode state ───────────────────────────────────────────────────────
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupResults, setGroupResults] = useState<GroupMacroResult[]>([]);
  const [loadingGroup, setLoadingGroup] = useState(false);
  const [groupVisibleKeys, setGroupVisibleKeys] = useState<Set<string>>(new Set());

  const plotDivs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Load groups list ───────────────────────────────────────────────────────
  useEffect(() => {
    listGroups().then(setGroups).catch(() => {});
  }, []);

  // ── Sync signal visibleChannels when macroData changes ────────────────────
  useEffect(() => {
    if (macroData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibleChannels(new Set(macroData.channels.map((c) => c.channel_name)));
    }
  }, [macroData]);

  // ── Load macro view on signal selection ───────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedId) { setMacroData(null); setRunChunks([]); setMacroError(false); return; }
    const sig = signals.find((s) => s.id === selectedId);
    if (!sig || sig.status !== 'COMPLETED') { setMacroData(null); setRunChunks([]); setMacroError(false); return; }
    let cancelled = false;
    setLoadingMacro(true);
    setMacroError(false);
    getMacroView(selectedId)
      .then((data) => { if (!cancelled) { setMacroData(data); } })
      .catch(() => { if (!cancelled) { setMacroData(null); setMacroError(true); } })
      .finally(() => { if (!cancelled) setLoadingMacro(false); });
    return () => { cancelled = true; };
  }, [selectedId, signals]);

  // ── Load group macro views ─────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (viewMode !== 'group' || !selectedGroupId) { setGroupResults([]); return; }
    const group = groups.find((g) => g.id === selectedGroupId);
    if (!group || !group.members.length) { setGroupResults([]); return; }

    let cancelled = false;
    setLoadingGroup(true);

    const sorted = [...group.members].sort((a, b) => a.display_order - b.display_order);
    Promise.all(
      sorted.map(async (m) => {
        const sig = signals.find((s) => s.id === m.signal_id);
        if (!sig || sig.status !== 'COMPLETED') return null;
        try {
          const macro = await getMacroView(m.signal_id);
          return { signalId: m.signal_id, filename: sig.original_filename, member: m, macro };
        } catch { return null; }
      })
    ).then((results) => {
      if (!cancelled) {
        const valid = results.filter(Boolean) as GroupMacroResult[];
        setGroupResults(valid);
        // Initialise all channel keys as visible
        const keys = new Set<string>();
        valid.forEach(({ signalId, macro }) =>
          macro.channels.forEach((ch) => keys.add(`${signalId}:${ch.channel_name}`))
        );
        setGroupVisibleKeys(keys);
      }
    }).finally(() => { if (!cancelled) setLoadingGroup(false); });

    return () => { cancelled = true; };
  }, [selectedGroupId, viewMode, groups, signals]);

  // ── Brush selection → load run chunks ─────────────────────────────────────
  const handleMacroRelayout = useCallback(
    async (event: Plotly.PlotRelayoutEvent) => {
      if (!macroData || !selectedId) return;
      const ev = event as unknown as Record<string, unknown>;
      const x0 = ev['xaxis.range[0]'] as number | undefined;
      const x1 = ev['xaxis.range[1]'] as number | undefined;
      if (x0 === undefined || x1 === undefined) return;
      const visible: RunBound[] = macroData.runs.filter((r) => r.start_x < x1 && r.end_x > x0);
      if (!visible.length) { setRunChunks([]); return; }
      setLoadingRuns(true);
      plotDivs.current.clear();
      try {
        setRunChunks(await getRunChunks(selectedId, visible.map((r) => r.run_id)));
      } finally { setLoadingRuns(false); }
    },
    [macroData, selectedId]
  );

  // ── Synchronized crosshairs ────────────────────────────────────────────────
  const handleMicroHover = useCallback((xFraction: number) => {
    const P = (window as unknown as { Plotly?: { relayout: (div: HTMLDivElement, update: object) => void } }).Plotly;
    if (!P) return;
    plotDivs.current.forEach((div, runId) => {
      const run = runChunks.find((r) => r.run_id === runId);
      if (!run || !run.x.length) return;
      const absX = xFraction * run.x[run.x.length - 1];
      try {
        P.relayout(div, { shapes: [{ type: 'line', x0: absX, x1: absX, y0: 0, y1: 1,
          xref: 'x', yref: 'paper', line: { color: '#ef4444', width: 1, dash: 'dot' } }] });
      } catch { /* unmounted */ }
    });
  }, [runChunks]);

  const handleMicroUnhover = useCallback(() => {
    const P = (window as unknown as { Plotly?: { relayout: (div: HTMLDivElement, update: object) => void } }).Plotly;
    if (!P) return;
    plotDivs.current.forEach((div) => { try { P.relayout(div, { shapes: [] }); } catch { /* unmounted */ } });
  }, []);

  // ── Signal macro traces ────────────────────────────────────────────────────
  const macroShapes = macroData?.runs.map((r) => ({
    type: 'rect' as const, xref: 'x' as const, yref: 'paper' as const,
    x0: r.start_x, x1: r.end_x, y0: 0, y1: 1,
    fillcolor: r.ooc_count > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)',
    line: { width: 0 }, layer: 'below' as const,
  })) ?? [];

  const macroTraces: Plotly.Data[] = macroData
    ? macroData.channels.flatMap((ch, i) => {
        if (!visibleChannels.has(ch.channel_name)) return [];
        const color = scientificColor(i);
        const oocX = macroData.x.filter((_, j) => ch.states[j] === 'OOC');
        const oocY = ch.y.filter((_, j) => ch.states[j] === 'OOC');
        return [
          { x: macroData.x, y: ch.y, type: 'scattergl', mode: 'lines',
            name: ch.channel_name, line: { color, width: 1 } } as Plotly.Data,
          ...(oocX.length > 0 ? [{
            x: oocX, y: oocY, type: 'scattergl', mode: 'markers',
            showlegend: false, marker: OOC_MARKER,
          } as Plotly.Data] : []),
        ];
      })
    : [];

  // ── Group macro traces (time-aligned, custom colors) ──────────────────────
  // Build a global flat channel list to assign palette indices
  const allGroupChannelKeys: string[] = [];
  groupResults.forEach(({ signalId, macro }) =>
    macro.channels.forEach((ch) => allGroupChannelKeys.push(`${signalId}:${ch.channel_name}`))
  );

  const groupTraces: Plotly.Data[] = groupResults.flatMap(({ signalId, filename, member, macro }) =>
    macro.channels.flatMap((ch) => {
      const key = `${signalId}:${ch.channel_name}`;
      if (!groupVisibleKeys.has(key)) return [];

      const palIdx = allGroupChannelKeys.indexOf(key);
      const color = member.channel_colors?.[ch.channel_name] ?? scientificColor(palIdx);
      const offsetX = macro.x.map((v) => v + (member.time_offset_s ?? 0));
      const oocX = offsetX.filter((_, j) => ch.states[j] === 'OOC');
      const oocY = ch.y.filter((_, j) => ch.states[j] === 'OOC');
      const label = macro.channels.length > 1 ? `${filename}·${ch.channel_name}` : filename;

      return [
        { x: offsetX, y: ch.y, type: 'scattergl', mode: 'lines',
          name: label, line: { color, width: 1.5 } } as Plotly.Data,
        ...(oocX.length > 0 ? [{
          x: oocX, y: oocY, type: 'scattergl', mode: 'markers',
          showlegend: false, marker: OOC_MARKER,
        } as Plotly.Data] : []),
      ];
    })
  );

  const isLight = theme === 'light';
  const axColor = isLight ? '#1a1a1a' : '#9ca3af';
  const gridColor = isLight ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.05)';
  const sliderBg = isLight ? '#f5f5f5' : '#18181b';
  const sliderBorder = isLight ? '#dee2e6' : '#3f3f46';

  const macroLayout: Partial<Plotly.Layout> = {
    ...buildChartTheme(theme),
    margin: { t: 8, r: 12, l: 52, b: 60 },
    showlegend: (macroData?.channels.length ?? 0) > 1,
    legend: { font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor }, bgcolor: 'transparent', x: 1, xanchor: 'right', y: 1 },
    shapes: macroShapes as Plotly.Shape[],
    xaxis: {
      color: axColor, gridcolor: gridColor, zerolinecolor: axColor,
      ticks: 'inside', tickcolor: axColor, linecolor: axColor, linewidth: 1, showline: true,
      mirror: isLight,
      tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor },
      rangeslider: { visible: true, thickness: 0.08, bgcolor: sliderBg, bordercolor: sliderBorder, borderwidth: 1 },
    },
    yaxis: {
      color: axColor, gridcolor: gridColor, zerolinecolor: axColor,
      ticks: 'inside', tickcolor: axColor, linecolor: axColor, linewidth: 1, showline: true,
      mirror: isLight,
      tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor },
    },
  };

  const groupLayout: Partial<Plotly.Layout> = {
    ...buildChartTheme(theme),
    margin: { t: 8, r: 12, l: 52, b: 60 },
    showlegend: true,
    legend: { font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor }, bgcolor: isLight ? '#ffffff' : '#18181b', bordercolor: sliderBorder, borderwidth: 1 },
    xaxis: {
      color: axColor, gridcolor: gridColor, zerolinecolor: axColor,
      ticks: 'inside', tickcolor: axColor, linecolor: axColor, linewidth: 1, showline: true,
      mirror: isLight,
      tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor },
      title: { text: 'Time (s, offset applied)', font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor } },
      rangeslider: { visible: true, thickness: 0.08, bgcolor: sliderBg, bordercolor: sliderBorder, borderwidth: 1 },
    },
    yaxis: {
      color: axColor, gridcolor: gridColor, zerolinecolor: axColor,
      ticks: 'inside', tickcolor: axColor, linecolor: axColor, linewidth: 1, showline: true,
      mirror: isLight,
      tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axColor },
    },
  };

  const selectedSignal = signals.find((s) => s.id === selectedId);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Mode toggle + selector panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
           style={{ background: 'var(--sp-surface-secondary)', borderColor: 'var(--sp-border)' }}>
        {/* Tab bar */}
        <div className="flex border-b" style={{ borderColor: 'var(--sp-border)' }}>
          <button
            onClick={() => setViewMode('signal')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-sans font-semibold transition-colors border-r
              ${viewMode === 'signal'
                ? 'text-zinc-100 bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-300'}`}
            style={{ borderColor: 'var(--sp-border)' }}
          >
            <Activity size={12} /> Signals
          </button>
          <button
            onClick={() => setViewMode('group')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-sans font-semibold transition-colors
              ${viewMode === 'group'
                ? 'text-zinc-100 bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <Layers size={12} /> Groups
          </button>
          {viewMode === 'signal' && (
            <div className="ml-auto flex items-center pr-3">
              <button
                onClick={() => setShowUploader((v) => !v)}
                className="flex items-center space-x-1.5 text-xs font-sans text-brand-400 hover:text-brand-500 transition-colors"
              >
                <UploadCloud size={13} />
                <span>{showUploader ? 'Cancel' : 'Upload New'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4">
          {/* ── Signal mode ────────────────────────────────────────────── */}
          {viewMode === 'signal' && (
            <>
              {showUploader && (
                <div className="mb-4">
                  <FileUploader onUploadComplete={(s) => { refresh(); setShowUploader(false); setSelectedId(s.id); }} />
                </div>
              )}
              {signals.length === 0 ? (
                <p className="text-xs font-sans text-zinc-500 py-2">No signals yet — upload a CSV or Parquet file to begin.</p>
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
                          <span className="text-zinc-600">{s.active_run_count}r · {s.ooc_count} OOC</span>
                        )}
                        <StatusBadge status={s.status} variant="inline" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Group mode ─────────────────────────────────────────────── */}
          {viewMode === 'group' && (
            <>
              {groups.length === 0 ? (
                <p className="text-xs font-sans text-zinc-500 py-2">
                  No groups yet — create one in the <span className="text-brand-400">Groups</span> page.
                </p>
              ) : (
                <div className="space-y-1">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGroupId(g.id)}
                      className={`w-full text-left flex items-center justify-between px-3 py-2 rounded text-xs font-sans transition-colors
                        ${selectedGroupId === g.id
                          ? 'bg-brand-500/15 border border-brand-500/30 text-zinc-100'
                          : 'hover:bg-zinc-800 text-zinc-300 border border-transparent'
                        }`}
                    >
                      <span className="flex items-center gap-2">
                        <Layers size={11} className="text-zinc-500 flex-shrink-0" />
                        <span className="truncate">{g.name}</span>
                      </span>
                      <span className="text-zinc-500 flex-shrink-0 ml-3">
                        {g.members.length} signal{g.members.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Signal: macro timeline ─────────────────────────────────────── */}
      {viewMode === 'signal' && selectedId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
             style={{ background: 'var(--sp-surface-secondary)', borderColor: 'var(--sp-border)' }}>
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Macro View</h2>
              <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
                LTTB-downsampled · drag rangeslider to load runs
                {macroData && ` · ${macroData.runs.length} runs`}
              </p>
            </div>

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
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 rounded-sm inline-block bg-red-500/20 border border-red-500/40" />OOC
                  </span>
                </div>
              </div>
            )}
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
                  <button
                    onClick={() => {
                      setMacroError(false); setLoadingMacro(true);
                      getMacroView(selectedId!)
                        .then((d) => { setMacroData(d); setMacroError(false); })
                        .catch(() => { setMacroData(null); setMacroError(true); })
                        .finally(() => setLoadingMacro(false));
                    }}
                    className="text-brand-400 underline"
                  >Retry</button>
                </span>
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
      )}

      {/* ── Group: aligned stacked view ────────────────────────────────── */}
      {viewMode === 'group' && selectedGroupId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
             style={{ background: 'var(--sp-surface-secondary)', borderColor: 'var(--sp-border)' }}>
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>
                Group View · {selectedGroup?.name}
              </h2>
              <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
                Time-aligned · channel colors from group config ·{' '}
                {groupResults.length} signal{groupResults.length !== 1 ? 's' : ''} loaded
              </p>
            </div>

            {/* Per-channel toggle for group view */}
            {groupResults.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end items-center max-w-md">
                {allGroupChannelKeys.map((key, i) => {
                  const [sigId, chName] = key.split(':');
                  const result = groupResults.find((r) => r.signalId === sigId);
                  if (!result) return null;
                  const color = result.member.channel_colors?.[chName] ?? scientificColor(i);
                  const active = groupVisibleKeys.has(key);
                  const label = result.macro.channels.length > 1
                    ? `${result.filename}·${chName}` : result.filename;
                  return (
                    <button
                      key={key}
                      title={label}
                      onClick={() => setGroupVisibleKeys((prev) => {
                        const next = new Set(prev);
                        if (active) { if (next.size > 1) next.delete(key); }
                        else next.add(key);
                        return next;
                      })}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-sans transition-opacity truncate max-w-[160px] ${active ? 'opacity-100' : 'opacity-30'}`}
                      style={{ border: `1px solid ${color}44`, color, backgroundColor: `${color}11` }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {loadingGroup ? (
            <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
              <Activity size={14} className="animate-spin mr-2" /> Loading group signals…
            </div>
          ) : groupResults.length === 0 ? (
            <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
              {selectedGroup?.members.length === 0
                ? 'This group has no signals yet — add some in the Groups page.'
                : 'No completed signals in this group.'}
            </div>
          ) : (
            <Plot data={groupTraces} layout={groupLayout} useResizeHandler
              style={{ width: '100%', height: '300px' }} config={{ displayModeBar: false }}
            />
          )}

          {/* Time offset summary */}
          {groupResults.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {groupResults.map(({ signalId, filename, member }) => (
                <div key={signalId} className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--sp-text-tertiary)' }}>
                  <span style={{ color: 'var(--sp-text-secondary)' }}>{filename}</span>
                  <span style={{ color: 'var(--sp-text-tertiary)' }}>offset:</span>
                  <span className={member.time_offset_s ? 'text-yellow-500' : ''} style={!member.time_offset_s ? { color: 'var(--sp-text-tertiary)' } : {}}>
                    {member.time_offset_s >= 0 ? '+' : ''}{member.time_offset_s}s
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Signal: micro grid ─────────────────────────────────────────── */}
      {viewMode === 'signal' && runChunks.length > 0 && (
        <div className="rounded-lg p-4" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
          <div className="mb-3">
            <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Run Grid</h2>
            <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
              {runChunks.length} run{runChunks.length !== 1 ? 's' : ''} · hover to sync crosshairs ·
              <span className="text-red-500"> OOC anomalies highlighted</span>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {runChunks.map((run) => (
              <MicroChart key={run.run_id} run={run} visibleChannels={visibleChannels}
                theme={theme}
                onInitialized={(id, div) => plotDivs.current.set(id, div)}
                onHover={handleMicroHover} onUnhover={handleMicroUnhover}
              />
            ))}
          </div>
        </div>
      )}

      {viewMode === 'signal' && loadingRuns && (
        <div className="flex items-center justify-center py-6 font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
          <Activity size={13} className="animate-spin mr-2" /> Loading run data…
        </div>
      )}

      {viewMode === 'signal' && !selectedId && signals.length > 0 && (
        <p className="text-center font-sans text-xs py-8" style={{ color: 'var(--sp-text-tertiary)' }}>
          Select a completed signal above to begin analysis.
        </p>
      )}

      {viewMode === 'group' && !selectedGroupId && groups.length > 0 && (
        <p className="text-center font-sans text-xs py-8" style={{ color: 'var(--sp-text-tertiary)' }}>
          Select a group above to view its aligned signals.
        </p>
      )}

      {viewMode === 'signal' && signals.length === 0 && !showUploader && (
        <div className="text-center py-16 space-y-3">
          <Activity size={40} className="mx-auto" style={{ color: 'var(--sp-text-tertiary)' }} />
          <p className="font-sans text-sm" style={{ color: 'var(--sp-text-secondary)' }}>No signals yet.</p>
          <button onClick={() => setShowUploader(true)}
            className="inline-flex items-center space-x-2 text-sm font-sans text-brand-400 transition-colors">
            <UploadCloud size={15} /><span>Upload your first signal</span>
          </button>
        </div>
      )}
    </div>
  );
}
