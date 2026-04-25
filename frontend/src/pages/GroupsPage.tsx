import { useEffect, useState } from 'react';
import {
  Layers, Plus, Trash2, ChevronDown, ChevronRight,
  Check, X, Clock, Pencil,
} from 'lucide-react';
import { useSignals } from '../context/SignalsContext';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  upsertGroupMember, removeGroupMember,
} from '../lib/api';
import { scientificColor } from '../lib/chartTheme';
import type { Group, GroupMember, GroupCreateRequest, GroupMemberUpsert } from '../types/signal';

// ── Inline editable text ──────────────────────────────────────────────────────
function InlineEdit({
  value, onSave, onCancel, placeholder,
}: { value: string; onSave: (v: string) => void; onCancel: () => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(v.trim());
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        className="bg-zinc-800 border border-brand-500/40 rounded px-2 py-0.5 text-xs font-mono text-zinc-100 focus:outline-none w-40"
      />
      <button onClick={() => onSave(v.trim())} className="text-green-400 hover:text-green-300">
        <Check size={12} />
      </button>
      <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
        <X size={12} />
      </button>
    </div>
  );
}

// ── Member row ────────────────────────────────────────────────────────────────
interface MemberRowProps {
  member: GroupMember;
  channelNames: string[];
  onUpdate: (patch: Partial<GroupMemberUpsert>) => void;
  onRemove: () => void;
}

function MemberRow({ member, channelNames, onUpdate, onRemove }: MemberRowProps) {
  const [offset, setOffset] = useState(String(member.time_offset_s ?? 0));
  const [editingOffset, setEditingOffset] = useState(false);

  const colors: Record<string, string> = member.channel_colors ?? {};

  function commitOffset() {
    const n = parseFloat(offset);
    if (!isNaN(n)) onUpdate({ time_offset_s: n });
    setEditingOffset(false);
  }

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 bg-zinc-800/50 rounded border border-zinc-700/50">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-zinc-200 truncate">{member.signal_id}</p>

        {/* Channel color pickers */}
        {channelNames.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {channelNames.map((ch, i) => {
              const currentColor = colors[ch] ?? scientificColor(i);
              return (
                <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="color"
                    value={currentColor}
                    onChange={(e) =>
                      onUpdate({ channel_colors: { ...colors, [ch]: e.target.value } })
                    }
                    className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                    style={{ accentColor: currentColor }}
                  />
                  <span className="text-[10px] font-mono text-zinc-400">{ch}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Time offset */}
      <div className="flex items-center gap-1 flex-shrink-0 self-center">
        <Clock size={10} className="text-zinc-500" />
        {editingOffset ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitOffset(); if (e.key === 'Escape') setEditingOffset(false); }}
              className="w-16 bg-zinc-800 border border-brand-500/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-100 focus:outline-none"
            />
            <span className="text-[10px] text-zinc-500 font-mono">s</span>
            <button onClick={commitOffset} className="text-green-400"><Check size={10} /></button>
          </div>
        ) : (
          <button
            onClick={() => setEditingOffset(true)}
            className="flex items-center gap-0.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <span>{member.time_offset_s ?? 0}s</span>
            <Pencil size={9} className="ml-0.5" />
          </button>
        )}
      </div>

      <button onClick={onRemove} className="text-zinc-600 hover:text-red-400 transition-colors self-center flex-shrink-0">
        <X size={13} />
      </button>
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────
interface GroupCardProps {
  group: Group;
  allSignalIds: { id: string; filename: string; channelNames: string[] }[];
  onRefresh: () => void;
  onDelete: () => void;
}

function GroupCard({ group, allSignalIds, onRefresh, onDelete }: GroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [addSignalId, setAddSignalId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleRename(newName: string) {
    if (!newName || newName === group.name) { setEditingName(false); return; }
    await updateGroup(group.id, { name: newName });
    setEditingName(false);
    onRefresh();
  }

  async function handleAddMember() {
    if (!addSignalId) return;
    await upsertGroupMember(group.id, { signal_id: addSignalId });
    setAddSignalId('');
    onRefresh();
  }

  async function handleUpdateMember(member: GroupMember, patch: Partial<GroupMemberUpsert>) {
    await upsertGroupMember(group.id, {
      signal_id: member.signal_id,
      time_offset_s: member.time_offset_s ?? 0,
      channel_colors: member.channel_colors ?? {},
      display_order: member.display_order ?? 0,
      ...patch,
    });
    onRefresh();
  }

  async function handleRemoveMember(signalId: string) {
    await removeGroupMember(group.id, signalId);
    onRefresh();
  }

  const memberIds = new Set(group.members.map((m) => m.signal_id));
  const availableSignals = allSignalIds.filter((s) => !memberIds.has(s.id));

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--sp-border)' }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? <ChevronDown size={14} className="text-zinc-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 flex-shrink-0" />}
          {editingName ? (
            <InlineEdit value={group.name} onSave={handleRename} onCancel={() => setEditingName(false)} />
          ) : (
            <span className="text-sm font-sans font-semibold truncate" style={{ color: 'var(--sp-text-primary)' }}>{group.name}</span>
          )}
        </button>

        <span className="text-[10px] font-sans flex-shrink-0" style={{ color: 'var(--sp-text-tertiary)' }}>
          {group.members.length} signal{group.members.length !== 1 ? 's' : ''}
        </span>

        <button
          onClick={() => setEditingName(true)}
          className="text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0"
          title="Rename"
        >
          <Pencil size={12} />
        </button>

        {confirmDelete ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onDelete} className="text-[10px] font-sans text-red-400 hover:text-red-300">Delete</button>
            <span style={{ color: 'var(--sp-text-tertiary)' }}>/</span>
            <button onClick={() => setConfirmDelete(false)} className="text-[10px] font-sans text-zinc-500 hover:text-zinc-300">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0" title="Delete group">
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Description */}
      {group.description && (
        <p className="px-4 py-1.5 text-[10px] font-sans" style={{ color: 'var(--sp-text-secondary)', borderBottom: '1px solid var(--sp-border)' }}>
          {group.description}
        </p>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 py-3 space-y-3">
          {/* Members */}
          {group.members.length === 0 ? (
            <p className="text-xs font-sans text-center py-2" style={{ color: 'var(--sp-text-tertiary)' }}>No signals yet — add one below.</p>
          ) : (
            <div className="space-y-2">
              {group.members.map((m) => {
                const sig = allSignalIds.find((s) => s.id === m.signal_id);
                return (
                  <MemberRow
                    key={m.signal_id}
                    member={{ ...m, signal_id: sig?.filename ?? m.signal_id }}
                    channelNames={sig?.channelNames ?? []}
                    onUpdate={(patch) => handleUpdateMember(m, patch)}
                    onRemove={() => handleRemoveMember(m.signal_id)}
                  />
                );
              })}
            </div>
          )}

          {/* Add signal */}
          {availableSignals.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <select
                value={addSignalId}
                onChange={(e) => setAddSignalId(e.target.value)}
                className="flex-1 rounded px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-brand-500/40"
                style={{ background: 'var(--sp-surface-elevated)', border: '1px solid var(--sp-border)', color: 'var(--sp-text-primary)' }}
              >
                <option value="">— add signal to group —</option>
                {availableSignals.map((s) => (
                  <option key={s.id} value={s.id}>{s.filename}</option>
                ))}
              </select>
              <button
                disabled={!addSignalId}
                onClick={handleAddMember}
                className="px-3 py-1.5 text-xs font-sans bg-brand-500 hover:bg-blue-400 disabled:opacity-40 text-white rounded transition-colors flex-shrink-0"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GroupsPage ────────────────────────────────────────────────────────────────
export default function GroupsPage() {
  const { signals } = useSignals();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const completedSignals = signals
    .filter((s) => s.status === 'COMPLETED')
    .map((s) => ({ id: s.id, filename: s.original_filename, channelNames: s.channel_names ?? [] }));

  async function loadGroups() {
    try {
      const data = await listGroups();
      setGroups(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadGroups(); }, []);

  async function handleCreate() {
    const trimmedName = newName.trim();
    if (!trimmedName) { setCreateError('Name is required'); return; }
    setCreateError(null);
    const body: GroupCreateRequest = { name: trimmedName };
    if (newDesc.trim()) body.description = newDesc.trim();
    await createGroup(body);
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    loadGroups();
  }

  async function handleDeleteGroup(id: string) {
    await deleteGroup(id);
    loadGroups();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers size={20} className="text-brand-500" />
          <div>
            <h1 className="text-sm font-semibold font-sans" style={{ color: 'var(--sp-text-primary)' }}>Groups</h1>
            <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-secondary)' }}>
              Bundle signals for multi-channel comparison and time alignment
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-sans bg-brand-500 hover:bg-blue-400 text-white rounded transition-colors"
        >
          <Plus size={13} />
          <span>{showCreate ? 'Cancel' : 'New Group'}</span>
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
          <p className="text-[10px] font-sans font-semibold uppercase tracking-wide" style={{ color: 'var(--sp-text-tertiary)' }}>New Group</p>
          {createError && (
            <p className="text-xs font-sans text-red-400">{createError}</p>
          )}
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>Name *</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                placeholder="e.g. Production Line A"
                className="w-full rounded px-2.5 py-1.5 text-xs font-sans focus:outline-none focus:border-brand-500/40"
                style={{ background: 'var(--sp-surface-elevated)', border: '1px solid var(--sp-border)', color: 'var(--sp-text-primary)' }}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>Description</label>
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional"
                className="w-full rounded px-2.5 py-1.5 text-xs font-sans focus:outline-none focus:border-brand-500/40"
                style={{ background: 'var(--sp-surface-elevated)', border: '1px solid var(--sp-border)', color: 'var(--sp-text-primary)' }}
              />
            </div>
            <button
              onClick={handleCreate}
              className="px-4 py-1.5 text-xs font-sans bg-brand-500 hover:bg-blue-400 text-white rounded transition-colors flex-shrink-0 self-end"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Groups list */}
      {loading ? (
        <p className="text-xs font-sans py-4" style={{ color: 'var(--sp-text-tertiary)' }}>Loading groups…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-lg p-12 text-center space-y-2" style={{ background: 'var(--sp-surface-secondary)', border: '1px dashed var(--sp-border)' }}>
          <Layers size={36} className="mx-auto" style={{ color: 'var(--sp-text-tertiary)' }} />
          <p className="text-xs font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>No groups yet — create one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              allSignalIds={completedSignals}
              onRefresh={loadGroups}
              onDelete={() => handleDeleteGroup(g.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
