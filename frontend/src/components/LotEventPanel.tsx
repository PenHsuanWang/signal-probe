import { useRef, useState } from 'react';
import { Plus, Trash2, Upload, X, Eye } from 'lucide-react';
import type { BulkImportResult, LotEvent, LotEventCreateRequest } from '../types/signal';

interface Props {
  events: LotEvent[];
  loading: boolean;
  error: string | null;
  onAdd: (data: LotEventCreateRequest) => Promise<void>;
  onDelete: (eventId: string) => Promise<void>;
  onUploadCsv: (file: File) => Promise<BulkImportResult>;
  onViewSlice: (lotId: string) => void;
}

function formatEpoch(epochS: number): string {
  try {
    return new Date(epochS * 1000).toLocaleString();
  } catch {
    return String(epochS);
  }
}

function AddEventForm({ onAdd, onClose }: { onAdd: Props['onAdd']; onClose: () => void }) {
  const [lotId, setLotId] = useState('');
  const [recipe, setRecipe] = useState('');
  const [waferCount, setWaferCount] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const cin = Number(checkIn);
    const cout = Number(checkOut);
    if (!lotId || !recipe || !waferCount || isNaN(cin) || isNaN(cout)) {
      setErr('All fields are required. Times must be Unix epoch seconds.');
      return;
    }
    if (cout <= cin) { setErr('Check-out must be after check-in.'); return; }
    setSubmitting(true);
    try {
      await onAdd({ lot_id: lotId, recipe, wafer_count: Number(waferCount), check_in_time: cin, check_out_time: cout });
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add event.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    'w-full rounded px-2 py-1 text-xs font-mono outline-none border transition-colors focus:border-orange-500/60' +
    ' bg-[var(--sp-surface-primary)] border-[var(--sp-border)] text-[var(--sp-text-primary)] placeholder:text-[var(--sp-text-tertiary)]';

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 rounded-lg border border-orange-500/30 bg-orange-500/5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Lot ID" value={lotId} onChange={(e) => setLotId(e.target.value)} />
        <input className={inputCls} placeholder="Recipe" value={recipe} onChange={(e) => setRecipe(e.target.value)} />
        <input className={inputCls} placeholder="Wafer count" type="number" min={1} value={waferCount} onChange={(e) => setWaferCount(e.target.value)} />
        <span /> {/* spacer */}
        <input className={inputCls} placeholder="Check-in (epoch s)" type="number" step="any" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        <input className={inputCls} placeholder="Check-out (epoch s)" type="number" step="any" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
      </div>
      {err && <p className="text-[10px] text-red-400">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-2.5 py-1 rounded text-xs font-sans border border-[var(--sp-border)] text-[var(--sp-text-secondary)] hover:border-orange-500/40 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="px-2.5 py-1 rounded text-xs font-sans bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 disabled:opacity-50 transition-colors">
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

export default function LotEventPanel({ events, loading, error, onAdd, onDelete, onUploadCsv, onViewSlice }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [csvResult, setCsvResult] = useState<BulkImportResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvResult(null);
    setCsvError(null);
    try {
      const result = await onUploadCsv(file);
      setCsvResult(result);
    } catch (ex: unknown) {
      setCsvError(ex instanceof Error ? ex.message : 'CSV upload failed.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section
      aria-label="Lot Events"
      className="rounded-lg p-4"
      style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xs font-semibold font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Lot Events</h2>
          <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
            Check-in / check-out markers overlaid on the waveform
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-sans border border-[var(--sp-border)] text-[var(--sp-text-secondary)] hover:border-orange-500/40 hover:text-orange-400 transition-colors"
          >
            <Upload size={11} aria-hidden="true" /> CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-sans border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
          >
            {showForm ? <X size={11} aria-hidden="true" /> : <Plus size={11} aria-hidden="true" />}
            {showForm ? 'Cancel' : 'Add'}
          </button>
        </div>
      </div>

      {/* CSV feedback */}
      {csvResult && (
        <div className="mb-2 text-[10px] font-sans rounded p-2 border border-green-500/30 bg-green-500/5 text-green-400">
          ✓ Imported {csvResult.imported} · Skipped {csvResult.skipped}
          {csvResult.errors.length > 0 && (
            <ul className="mt-1 list-disc ml-3 text-yellow-400">
              {csvResult.errors.map((e) => (
                <li key={`${e.row}-${e.lot_id}`}>Row {e.row}: {e.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {csvError && (
        <div className="mb-2 text-[10px] font-sans text-red-400 rounded p-2 border border-red-500/30 bg-red-500/5">
          ✗ {csvError}
          <button className="ml-2 underline" onClick={() => setCsvError(null)}>Dismiss</button>
        </div>
      )}

      {showForm && <AddEventForm onAdd={onAdd} onClose={() => setShowForm(false)} />}

      {/* Events table */}
      {loading ? (
        <p className="text-xs font-sans text-center py-4" style={{ color: 'var(--sp-text-tertiary)' }}>Loading…</p>
      ) : error ? (
        <p className="text-xs font-sans text-red-400 py-2">⚠ {error}</p>
      ) : events.length === 0 ? (
        <p className="text-xs font-sans text-center py-4" style={{ color: 'var(--sp-text-tertiary)' }}>
          No lot events — add manually or upload a CSV.
        </p>
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[10px] font-mono" aria-label="Lot event list">
            <thead>
              <tr style={{ color: 'var(--sp-text-tertiary)', borderBottom: '1px solid var(--sp-border)' }}>
                <th className="text-left pb-1 pr-3">Lot ID</th>
                <th className="text-left pb-1 pr-3">Recipe</th>
                <th className="text-left pb-1 pr-3">Wafers</th>
                <th className="text-left pb-1 pr-3">Check-in</th>
                <th className="text-left pb-1 pr-3">Check-out</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id} className="hover:bg-orange-500/5 transition-colors" style={{ borderBottom: '1px solid var(--sp-border)' }}>
                  <td className="py-1 pr-3" style={{ color: 'var(--sp-text-primary)' }}>{evt.lot_id}</td>
                  <td className="py-1 pr-3" style={{ color: 'var(--sp-text-secondary)' }}>{evt.recipe}</td>
                  <td className="py-1 pr-3" style={{ color: 'var(--sp-text-secondary)' }}>{evt.wafer_count}</td>
                  <td className="py-1 pr-3" style={{ color: 'var(--sp-text-tertiary)' }}>{formatEpoch(evt.check_in_time)}</td>
                  <td className="py-1 pr-3" style={{ color: 'var(--sp-text-tertiary)' }}>{formatEpoch(evt.check_out_time)}</td>
                  <td className="py-1 flex gap-1.5 justify-end">
                    <button
                      onClick={() => onViewSlice(evt.lot_id)}
                      aria-label={`View slice for ${evt.lot_id}`}
                      className="p-0.5 rounded text-[var(--sp-text-tertiary)] hover:text-orange-400 transition-colors"
                    >
                      <Eye size={11} />
                    </button>
                    <button
                      onClick={() => onDelete(evt.id)}
                      aria-label={`Delete ${evt.lot_id}`}
                      className="p-0.5 rounded text-[var(--sp-text-tertiary)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
