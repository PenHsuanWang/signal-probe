import { useState, useCallback, useMemo } from 'react';
import { Database, UploadCloud, Search, Pencil, Trash2, Check, X, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ColumnConfigPanel from '../components/ColumnConfigPanel';
import FileUploader from '../components/FileUploader';
import StatusBadge from '../components/StatusBadge';
import { useSignals } from '../context/SignalsContext';
import { deleteSignal, reconfigureSignal, renameSignal } from '../lib/api';
import { scientificColor } from '../lib/chartTheme';
import type { SignalMetadata } from '../types/signal';

function ChannelPills({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n, i) => (
        <span
          key={n}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
          style={{ backgroundColor: `${scientificColor(i)}22`, color: scientificColor(i) }}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

export default function SignalsPage() {
  const navigate = useNavigate();
  const { signals, refresh } = useSignals();
  const [showUploader, setShowUploader] = useState(false);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  const filtered = useMemo(
    () => signals.filter((s) =>
      s.original_filename.toLowerCase().includes(search.toLowerCase())
    ),
    [signals, search],
  );

  const handleRenameSubmit = useCallback(async (s: SignalMetadata) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === s.original_filename) {
      setRenamingId(null);
      return;
    }
    setRenameError(null);
    try {
      await renameSignal(s.id, trimmed);
      await refresh();
    } catch {
      setRenameError('Rename failed');
    } finally {
      setRenamingId(null);
    }
  }, [renameValue, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteSignal(id);
      await refresh();
    } catch { /* ignore */ } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }, [refresh]);

  const handleReconfigure = useCallback(async (id: string) => {
    try {
      await reconfigureSignal(id);
      await refresh();
      setConfiguringId(id);
    } catch { /* ignore */ }
  }, [refresh]);

  const handleUploadComplete = useCallback((signal: SignalMetadata) => {
    refresh();
    setShowUploader(false);
    if (signal?.id) setConfiguringId(signal.id);
  }, [refresh]);

  const handleConfigured = useCallback(async () => {
    setConfiguringId(null);
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database size={20} className="text-brand-500" />
          <div>
            <h1 className="text-sm font-semibold font-sans" style={{ color: 'var(--sp-text-primary)' }}>Signals</h1>
            <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-secondary)' }}>
              {signals.length} total · {signals.filter((s) => s.status === 'COMPLETED').length} ready
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowUploader((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-sans bg-brand-500 hover:bg-blue-400 text-white rounded transition-colors"
        >
          <UploadCloud size={14} />
          <span>{showUploader ? 'Cancel' : 'Upload Signal'}</span>
        </button>
      </div>

      {/* Upload panel */}
      {showUploader && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <FileUploader onUploadComplete={handleUploadComplete} />
        </div>
      )}

      {/* Rename error toast */}
      {renameError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 text-xs font-sans text-red-400">
          <X size={12} /> {renameError}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by filename…"
          className="w-full rounded text-xs font-sans pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500/40 focus:border-brand-500/40 transition-all"
          style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)', color: 'var(--sp-text-primary)' }}
        />
      </div>

      {/* Signal table */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_60px_110px_90px_80px] gap-3 px-4 py-2.5 text-[10px] font-sans font-semibold uppercase tracking-wide"
             style={{ borderBottom: '1px solid var(--sp-border)', color: 'var(--sp-text-tertiary)' }}>
          <span>Filename</span>
          <span>Channels</span>
          <span>Runs</span>
          <span>Status</span>
          <span>Uploaded</span>
          <span>Actions</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Database size={32} className="mx-auto" style={{ color: 'var(--sp-text-tertiary)' }} />
            <p className="text-xs font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>
              {search ? 'No signals match your search.' : 'No signals yet — upload a file above.'}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--sp-border)' }}>
            {filtered.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_60px_110px_90px_80px] gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors items-center"
              >
                {/* Filename / Rename inline */}
                <div className="min-w-0">
                  {renamingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(s);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="flex-1 min-w-0 bg-zinc-800 border border-brand-500/40 rounded px-2 py-0.5 text-xs font-mono text-zinc-100 focus:outline-none"
                      />
                      <button onClick={() => handleRenameSubmit(s)} className="text-green-400 hover:text-green-300 flex-shrink-0">
                        <Check size={12} />
                      </button>
                      <button onClick={() => setRenamingId(null)} className="text-zinc-500 hover:text-zinc-300 flex-shrink-0">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-mono truncate block" title={s.original_filename}
                          style={{ color: 'var(--sp-text-primary)' }}>
                      {s.original_filename}
                    </span>
                  )}
                </div>

                {/* Channel pills */}
                <div>
                  {s.status === 'COMPLETED' && s.channel_names?.length > 0
                    ? <ChannelPills names={s.channel_names} />
                    : <span className="text-xs font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>—</span>
                  }
                </div>

                <span className="text-xs font-mono" style={{ color: 'var(--sp-text-secondary)' }}>
                  {s.status === 'COMPLETED' ? `${s.active_run_count}r` : '—'}
                </span>
                <div><StatusBadge status={s.status} /></div>
                <span className="text-xs font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>
                  {new Date(s.created_at).toLocaleDateString()}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {s.status === 'AWAITING_CONFIG' && (
                    <button
                      onClick={() => setConfiguringId(s.id)}
                      className="text-[10px] font-sans text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      Configure →
                    </button>
                  )}
                  {s.status === 'COMPLETED' && (
                    <button
                      onClick={() => navigate(`/?signalId=${s.id}`)}
                      className="text-[10px] font-sans text-brand-400 hover:text-blue-300 transition-colors"
                    >
                      Explore →
                    </button>
                  )}
                  {(s.status === 'COMPLETED' || s.status === 'FAILED') && (
                    <button
                      onClick={() => handleReconfigure(s.id)}
                      className="text-zinc-500 hover:text-purple-400 transition-colors"
                      title="Reconfigure columns"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => { setRenamingId(s.id); setRenameValue(s.original_filename); }}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Rename"
                  >
                    <Pencil size={12} />
                  </button>

                  {/* Delete with inline confirm */}
                  {confirmDeleteId === s.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        disabled={deletingId === s.id}
                        onClick={() => handleDelete(s.id)}
                        className="text-[10px] font-sans text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === s.id ? '…' : 'Yes'}
                      </button>
                      <span style={{ color: 'var(--sp-text-tertiary)' }}>/</span>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[10px] font-sans text-zinc-500 hover:text-zinc-300"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(s.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Column config panel — rendered as overlay below table */}
      {configuringId && (
        <div className="rounded-lg p-5" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
          <ColumnConfigPanel
            signalId={configuringId}
            onConfigured={handleConfigured}
            onCancel={() => setConfiguringId(null)}
          />
        </div>
      )}
    </div>
  );
}
