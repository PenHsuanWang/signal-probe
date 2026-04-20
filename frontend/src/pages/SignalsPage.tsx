import { useState } from 'react';
import { Database, UploadCloud, RefreshCw, Search, Pencil, Trash2, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FileUploader from '../components/FileUploader';
import { useSignals } from '../context/SignalsContext';
import { deleteSignal, renameSignal } from '../lib/api';
import type { SignalMetadata } from '../types/signal';

const CHANNEL_PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16',
];

function StatusBadge({ status }: { status: SignalMetadata['status'] }) {
  const cls: Record<SignalMetadata['status'], string> = {
    PENDING:    'text-yellow-400 bg-yellow-400/10',
    PROCESSING: 'text-blue-400   bg-blue-400/10',
    COMPLETED:  'text-green-400  bg-green-400/10',
    FAILED:     'text-red-400    bg-red-400/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${cls[status]}`}>
      {status === 'PROCESSING' && <RefreshCw size={9} className="animate-spin" />}
      {status}
    </span>
  );
}

function ChannelPills({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n, i) => (
        <span
          key={n}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
          style={{ backgroundColor: `${CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]}22`,
                   color: CHANNEL_PALETTE[i % CHANNEL_PALETTE.length] }}
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

  const filtered = signals.filter((s) =>
    s.original_filename.toLowerCase().includes(search.toLowerCase())
  );

  async function handleRenameSubmit(s: SignalMetadata) {
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
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteSignal(id);
      await refresh();
    } catch { /* ignore */ } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database size={20} className="text-brand-500" />
          <div>
            <h1 className="text-sm font-bold font-mono text-zinc-100 tracking-widest uppercase">Signals</h1>
            <p className="text-xs font-mono text-zinc-500 mt-0.5">
              {signals.length} total · {signals.filter((s) => s.status === 'COMPLETED').length} ready
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowUploader((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-brand-500 hover:bg-blue-400 text-white rounded transition-colors"
        >
          <UploadCloud size={14} />
          <span>{showUploader ? 'Cancel' : 'Upload Signal'}</span>
        </button>
      </div>

      {/* Upload panel */}
      {showUploader && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <FileUploader onUploadComplete={() => { refresh(); setShowUploader(false); }} />
        </div>
      )}

      {/* Rename error toast */}
      {renameError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 text-xs font-mono text-red-400">
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
          className="w-full bg-zinc-900 border border-zinc-800 rounded text-xs font-mono text-zinc-300 pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500/40 focus:border-brand-500/40 placeholder:text-zinc-600 transition-all"
        />
      </div>

      {/* Signal table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_60px_60px_110px_90px_80px] gap-3 px-4 py-2.5 border-b border-zinc-800 text-[10px] font-mono font-bold text-zinc-600 uppercase tracking-widest">
          <span>Filename</span>
          <span>Channels</span>
          <span>Runs</span>
          <span>OOC</span>
          <span>Status</span>
          <span>Uploaded</span>
          <span>Actions</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Database size={32} className="text-zinc-700 mx-auto" />
            <p className="text-xs font-mono text-zinc-600">
              {search ? 'No signals match your search.' : 'No signals yet — upload a file above.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_60px_60px_110px_90px_80px] gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors items-center"
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
                    <span className="text-xs font-mono text-zinc-200 truncate block" title={s.original_filename}>
                      {s.original_filename}
                    </span>
                  )}
                </div>

                {/* Channel pills */}
                <div>
                  {s.status === 'COMPLETED' && s.channel_names?.length > 0
                    ? <ChannelPills names={s.channel_names} />
                    : <span className="text-zinc-600 text-xs font-mono">—</span>
                  }
                </div>

                <span className="text-xs font-mono text-zinc-400">
                  {s.status === 'COMPLETED' ? `${s.active_run_count}r` : '—'}
                </span>
                <span className={`text-xs font-mono ${s.ooc_count > 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                  {s.status === 'COMPLETED' ? s.ooc_count : '—'}
                </span>
                <div><StatusBadge status={s.status} /></div>
                <span className="text-xs font-mono text-zinc-600">
                  {new Date(s.created_at).toLocaleDateString()}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {s.status === 'COMPLETED' && (
                    <button
                      onClick={() => navigate('/')}
                      className="text-[10px] font-mono text-brand-400 hover:text-blue-300 transition-colors"
                    >
                      Explore →
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
                        className="text-[10px] font-mono text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === s.id ? '…' : 'Yes'}
                      </button>
                      <span className="text-zinc-600">/</span>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300"
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
    </div>
  );
}
