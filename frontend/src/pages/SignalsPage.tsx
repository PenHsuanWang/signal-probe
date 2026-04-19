import { useState, useCallback, useEffect, useRef } from 'react';
import { Database, UploadCloud, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FileUploader from '../components/FileUploader';
import { listSignals } from '../lib/api';
import type { SignalMetadata } from '../types/signal';

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

export default function SignalsPage() {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<SignalMetadata[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [search, setSearch] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setSignals(await listSignals()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const filtered = signals.filter((s) =>
    s.original_filename.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database size={20} className="text-brand-500" />
          <div>
            <h1 className="text-sm font-bold font-mono text-zinc-100 tracking-widest uppercase">
              Signals
            </h1>
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
          <FileUploader
            onUploadComplete={(s) => {
              setSignals((p) => [s, ...p]);
              setShowUploader(false);
            }}
          />
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
        <div className="grid grid-cols-[minmax(0,2fr)_80px_80px_120px_100px_80px] gap-4 px-4 py-2.5 border-b border-zinc-800 text-[10px] font-mono font-bold text-zinc-600 uppercase tracking-widest">
          <span>Filename</span>
          <span>Runs</span>
          <span>OOC</span>
          <span>Status</span>
          <span>Uploaded</span>
          <span>Action</span>
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
                className="grid grid-cols-[minmax(0,2fr)_80px_80px_120px_100px_80px] gap-4 px-4 py-3 hover:bg-zinc-800/40 transition-colors"
              >
                <span className="text-xs font-mono text-zinc-200 truncate" title={s.original_filename}>
                  {s.original_filename}
                </span>
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
                <div>
                  {s.status === 'COMPLETED' && (
                    <button
                      onClick={() => navigate('/')}
                      className="text-[10px] font-mono text-brand-400 hover:text-blue-300 transition-colors"
                    >
                      Explore →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-[10px] font-mono text-zinc-700 py-1">
        Delete · Rename · Group assignment — coming in the next update
      </p>
    </div>
  );
}
