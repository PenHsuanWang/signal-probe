import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plot } from '../lib/plot';
import { Activity, ArrowLeft, Layers } from 'lucide-react';
import { getMacroView, listGroups } from '../lib/api';
import { useSignals } from '../context/SignalsContext';
import { useTheme } from '../context/ThemeContext';
import { buildChartTheme, scientificColor } from '../lib/chartTheme';
import type { Group, GroupMember, MacroViewResponse } from '../types/signal';

interface GroupMacroResult {
  signalId: string;
  filename: string;
  member: GroupMember;
  macro: MacroViewResponse;
}

/**
 * Group Detail page — /groups/:id
 * Renders a time-aligned multi-signal overlay chart for all members of a group.
 */
export default function GroupDetailPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { signals } = useSignals();
  const { theme } = useTheme();

  const [group, setGroup] = useState<Group | null>(null);
  const [groupResults, setGroupResults] = useState<GroupMacroResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupVisibleKeys, setGroupVisibleKeys] = useState<Set<string>>(new Set());

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const groups = await listGroups();
      const found = groups.find((g) => g.id === groupId) ?? null;
      setGroup(found);
      if (!found || !found.members.length) {
        setGroupResults([]);
        return;
      }
      const sorted = [...found.members].sort((a, b) => a.display_order - b.display_order);
      const results = await Promise.all(
        sorted.map(async (m) => {
          const sig = signals.find((s) => s.id === m.signal_id);
          if (!sig || sig.status !== 'COMPLETED') return null;
          try {
            const macro = await getMacroView(m.signal_id);
            return { signalId: m.signal_id, filename: sig.original_filename, member: m, macro };
          } catch { return null; }
        }),
      );
      const valid = results.filter(Boolean) as GroupMacroResult[];
      setGroupResults(valid);
      const keys = new Set<string>();
      valid.forEach(({ signalId, macro }) =>
        macro.channels.forEach((ch) => keys.add(`${signalId}:${ch.channel_name}`))
      );
      setGroupVisibleKeys(keys);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [groupId, signals]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  // ── Chart data ─────────────────────────────────────────────────────────────
  const allGroupChannelKeys = useMemo(() => {
    const keys: string[] = [];
    groupResults.forEach(({ signalId, macro }) =>
      macro.channels.forEach((ch) => keys.push(`${signalId}:${ch.channel_name}`))
    );
    return keys;
  }, [groupResults]);

  const groupTraces: Plotly.Data[] = groupResults.flatMap(({ signalId, filename, member, macro }) =>
    macro.channels.flatMap((ch) => {
      const key = `${signalId}:${ch.channel_name}`;
      if (!groupVisibleKeys.has(key)) return [];
      const palIdx = allGroupChannelKeys.indexOf(key);
      const color = member.channel_colors?.[ch.channel_name] ?? scientificColor(palIdx);
      const offsetX = macro.x.map((v) => v + (member.time_offset_s ?? 0));
      const label = macro.channels.length > 1 ? `${filename}·${ch.channel_name}` : filename;
      return [{ x: offsetX, y: ch.y, type: 'scattergl', mode: 'lines',
        name: label, line: { color, width: 1.5 } } as Plotly.Data];
    })
  );

  const groupLayout = useMemo((): Partial<Plotly.Layout> => {
    const isLightMode = theme === 'light';
    const axisColor = isLightMode ? '#1a1a1a' : '#9ca3af';
    const grid = isLightMode ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.05)';
    const slidBg = isLightMode ? '#f5f5f5' : '#18181b';
    const slidBorder = isLightMode ? '#dee2e6' : '#3f3f46';
    return {
      ...buildChartTheme(theme),
      margin: { t: 8, r: 12, l: 52, b: 60 },
      showlegend: true,
      legend: { font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        bgcolor: isLightMode ? '#ffffff' : '#18181b', bordercolor: slidBorder, borderwidth: 1 },
      xaxis: {
        color: axisColor, gridcolor: grid, zerolinecolor: axisColor,
        ticks: 'inside', tickcolor: axisColor, linecolor: axisColor, linewidth: 1, showline: true,
        mirror: isLightMode,
        tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
        title: { text: 'Time (s, offset applied)', font: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor } },
        rangeslider: { visible: true, thickness: 0.08, bgcolor: slidBg, bordercolor: slidBorder, borderwidth: 1 },
      },
      yaxis: {
        color: axisColor, gridcolor: grid, zerolinecolor: axisColor,
        ticks: 'inside', tickcolor: axisColor, linecolor: axisColor, linewidth: 1, showline: true,
        mirror: isLightMode,
        tickfont: { size: 10, family: 'Inter, ui-sans-serif, sans-serif', color: axisColor },
      },
    };
  }, [theme]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/groups"
          className="flex items-center gap-1.5 text-xs font-sans transition-colors"
          style={{ color: 'var(--sp-text-tertiary)' }}
        >
          <ArrowLeft size={13} /> Groups
        </Link>
        <span style={{ color: 'var(--sp-border)' }}>/</span>
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-brand-500 flex-shrink-0" />
          <span className="text-sm font-semibold font-sans" style={{ color: 'var(--sp-text-primary)' }}>
            {group?.name ?? '…'}
          </span>
          {group && (
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>
              · {group.members.length} signal{group.members.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Overlay chart */}
      <div className="rounded-lg p-4" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>
              Group View · {group?.name}
            </h2>
            <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
              Time-aligned · channel colors from group config ·{' '}
              {groupResults.length} signal{groupResults.length !== 1 ? 's' : ''} loaded
            </p>
          </div>

          {/* Per-channel toggle */}
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

        {loading ? (
          <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
            <Activity size={14} className="animate-spin mr-2" /> Loading group signals…
          </div>
        ) : !group ? (
          <div className="h-64 flex items-center justify-center font-sans text-xs text-red-400">
            Group not found.
          </div>
        ) : groupResults.length === 0 ? (
          <div className="h-64 flex items-center justify-center font-sans text-xs" style={{ color: 'var(--sp-text-tertiary)' }}>
            {group.members.length === 0
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
                <span>offset:</span>
                <span className={member.time_offset_s ? 'text-yellow-500' : ''} style={!member.time_offset_s ? { color: 'var(--sp-text-tertiary)' } : {}}>
                  {member.time_offset_s >= 0 ? '+' : ''}{member.time_offset_s}s
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
