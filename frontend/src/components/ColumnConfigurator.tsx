import { useCallback, useEffect, useState } from 'react';
import { Settings2, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { getRawColumns, configureSignal } from '../lib/api';
import type { RawColumnsResponse } from '../types/signal';

interface ColumnConfiguratorProps {
  signalId: string;
  filename: string;
  onConfigured: () => void;
}

export default function ColumnConfigurator({ signalId, filename, onConfigured }: ColumnConfiguratorProps) {
  const [colData, setColData] = useState<RawColumnsResponse | null>(null);
  const [loadingCols, setLoadingCols] = useState(true);
  const [colsError, setColsError] = useState<string | null>(null);

  const [timeColumn, setTimeColumn] = useState('');
  const [signalColumns, setSignalColumns] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingCols(true);
    setColsError(null);
    getRawColumns(signalId)
      .then((data) => {
        setColData(data);
        setTimeColumn(data.suggested_time_column ?? data.columns[0] ?? '');
        setSignalColumns(new Set(data.suggested_signal_columns));
      })
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setColsError(detail ?? 'Could not read file columns');
      })
      .finally(() => setLoadingCols(false));
  }, [signalId]);

  const toggleSignalColumn = useCallback((col: string) => {
    setSignalColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        if (next.size > 1) next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!timeColumn || signalColumns.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await configureSignal(signalId, {
        time_column: timeColumn,
        signal_columns: Array.from(signalColumns),
      });
      onConfigured();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSubmitError(detail ?? 'Failed to start processing');
    } finally {
      setSubmitting(false);
    }
  }, [signalId, timeColumn, signalColumns, onConfigured]);

  return (
    <div className="rounded-lg p-4 space-y-4"
         style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>

      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings2 size={14} className="text-brand-400" />
        <div>
          <p className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-primary)' }}>
            Configure columns
          </p>
          <p className="text-[10px] font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
            {filename} · select the time axis and signal channels to analyze
          </p>
        </div>
      </div>

      {loadingCols ? (
        <div className="flex items-center gap-2 text-xs font-sans" style={{ color: 'var(--sp-text-tertiary)' }}>
          <Loader2 size={12} className="animate-spin" /> Reading file columns…
        </div>
      ) : colsError ? (
        <div className="flex items-center gap-2 text-xs font-sans text-red-400">
          <AlertCircle size={12} /> {colsError}
        </div>
      ) : colData && (
        <div className="space-y-4">
          {/* Time column selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-sans font-semibold uppercase tracking-wide"
                   style={{ color: 'var(--sp-text-tertiary)' }}>
              Time / index column
            </label>
            <div className="flex flex-wrap gap-1.5">
              {colData.columns.map((col) => (
                <button
                  key={col}
                  onClick={() => {
                    setTimeColumn(col);
                    // Remove from signal columns if selected as time
                    setSignalColumns((prev) => {
                      const next = new Set(prev);
                      next.delete(col);
                      return next.size > 0 ? next : prev;
                    });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all
                    ${timeColumn === col
                      ? 'bg-amber-500/20 border border-amber-500/50 text-amber-400'
                      : 'border text-zinc-400 hover:text-zinc-200'
                    }`}
                  style={timeColumn !== col ? { borderColor: 'var(--sp-border)' } : {}}
                >
                  {col}
                  {timeColumn === col && <span className="ml-1 text-amber-400">⟵ time</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Signal columns multi-select */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-sans font-semibold uppercase tracking-wide"
                   style={{ color: 'var(--sp-text-tertiary)' }}>
              Signal columns <span className="normal-case font-normal">(select one or more)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {colData.columns
                .filter((col) => col !== timeColumn)
                .map((col) => {
                  const selected = signalColumns.has(col);
                  return (
                    <button
                      key={col}
                      onClick={() => toggleSignalColumn(col)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all
                        ${selected
                          ? 'bg-brand-500/20 border border-brand-500/40 text-brand-400'
                          : 'border text-zinc-500 hover:text-zinc-300'
                        }`}
                      style={!selected ? { borderColor: 'var(--sp-border)' } : {}}
                    >
                      {selected && <CheckCircle2 size={9} />}
                      {col}
                    </button>
                  );
                })}
            </div>
            {signalColumns.size === 0 && (
              <p className="text-[10px] font-sans text-red-400">Select at least one signal column.</p>
            )}
          </div>

          {/* Summary */}
          {timeColumn && signalColumns.size > 0 && (
            <div className="text-[10px] font-mono rounded px-2 py-1.5 space-y-0.5"
                 style={{ background: 'var(--sp-surface-primary)', color: 'var(--sp-text-tertiary)' }}>
              <span className="text-amber-400">time:</span> {timeColumn}
              {' · '}
              <span className="text-brand-400">signals:</span>{' '}
              {Array.from(signalColumns).join(', ')}
            </div>
          )}

          {submitError && (
            <div className="flex items-center gap-2 text-xs font-sans text-red-400">
              <AlertCircle size={12} /> {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !timeColumn || signalColumns.size === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-sans bg-brand-500 hover:bg-blue-400 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Settings2 size={12} />}
            {submitting ? 'Starting…' : 'Process signal'}
          </button>
        </div>
      )}
    </div>
  );
}
