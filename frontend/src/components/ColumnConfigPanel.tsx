import React, { useCallback, useId } from 'react';
import {
  Settings2, Clock, Activity,
  ChevronRight, AlertCircle, Loader2,
} from 'lucide-react';
import { isNumericDtype, useColumnConfig } from '../hooks/useColumnConfig';
import type { ColumnDescriptor } from '../types/signal';

// ---------------------------------------------------------------------------
// Public Props
// ---------------------------------------------------------------------------

export interface ColumnConfigPanelProps {
  /** UUID of the signal to configure (must be in AWAITING_CONFIG state). */
  signalId: string;
  /** Called after the POST /process request succeeds. */
  onConfigured: () => void;
  /** Called when the user dismisses the panel without submitting. */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ColumnRowProps {
  col: ColumnDescriptor;
  isSelected: boolean;
  isDisabled?: boolean;
  inputType: 'radio' | 'checkbox';
  radioGroupName?: string;
  onChange: (name: string) => void;
}

function ColumnRow({
  col, isSelected, isDisabled = false, inputType, radioGroupName, onChange,
}: ColumnRowProps) {
  const handleChange = useCallback(() => {
    if (!isDisabled) onChange(col.name);
  }, [col.name, isDisabled, onChange]);

  const borderColor = isSelected ? 'var(--sp-brand,#3b82f6)' : 'var(--sp-border)';
  const bg = isSelected ? 'var(--sp-surface-elevated)' : undefined;

  return (
    <label
      className="flex items-start gap-2 px-2.5 py-2 rounded cursor-pointer transition-colors hover:bg-zinc-800/40"
      style={{ background: bg, border: `1px solid ${borderColor}`, opacity: isDisabled ? 0.5 : 1 }}
      aria-disabled={isDisabled}
    >
      <input
        type={inputType}
        name={radioGroupName}
        value={col.name}
        checked={isSelected}
        disabled={isDisabled}
        onChange={handleChange}
        className="mt-0.5 accent-blue-500"
        aria-label={col.name}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold truncate" style={{ color: 'var(--sp-text-primary)' }}>
            {col.name}
          </span>
          {col.is_candidate_time && (
            <span className="px-1 py-0 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-400">
              suggested
            </span>
          )}
          {inputType === 'checkbox' && !isNumericDtype(col.dtype) && (
            <span className="px-1 py-0 rounded text-[9px] font-semibold bg-zinc-700 text-zinc-400">
              non-numeric
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--sp-text-tertiary)' }}>
          {col.dtype}
          {col.sample_values.length > 0 && (
            <span className="ml-1 opacity-70">
              e.g. {col.sample_values.slice(0, 2).join(', ')}
            </span>
          )}
        </div>
      </div>
    </label>
  );
}

interface TimeColumnSelectorProps {
  columns: ColumnDescriptor[];
  selected: string | null;
  radioGroupName: string;
  labelId: string;
  onSelect: (name: string) => void;
}

function TimeColumnSelector({
  columns, selected, radioGroupName, labelId, onSelect,
}: TimeColumnSelectorProps) {
  return (
    <div className="space-y-2" role="radiogroup" aria-labelledby={labelId}>
      <div id={labelId} className="flex items-center gap-1.5" style={{ color: 'var(--sp-text-secondary)' }}>
        <Clock size={12} aria-hidden="true" />
        <span className="font-semibold uppercase tracking-wide text-[10px]">Time axis column</span>
        <span className="text-red-400" aria-hidden="true">*</span>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1" role="list">
        {columns.map((col) => (
          <div key={col.name} role="listitem">
            <ColumnRow
              col={col}
              isSelected={selected === col.name}
              inputType="radio"
              radioGroupName={radioGroupName}
              onChange={onSelect}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SignalColumnSelectorProps {
  columns: ColumnDescriptor[];
  selectedTimeCol: string | null;
  sigCols: Set<string>;
  labelId: string;
  onToggle: (name: string) => void;
}

function SignalColumnSelector({
  columns, selectedTimeCol, sigCols, labelId, onToggle,
}: SignalColumnSelectorProps) {
  const availableCols = columns.filter((c) => c.name !== selectedTimeCol);

  return (
    <div className="space-y-2" role="group" aria-labelledby={labelId}>
      <div id={labelId} className="flex items-center gap-1.5" style={{ color: 'var(--sp-text-secondary)' }}>
        <Activity size={12} aria-hidden="true" />
        <span className="font-semibold uppercase tracking-wide text-[10px]">Signal channels</span>
        <span className="text-red-400" aria-hidden="true">*</span>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1" role="list">
        {availableCols.map((col) => (
          <div key={col.name} role="listitem">
            <ColumnRow
              col={col}
              isSelected={sigCols.has(col.name)}
              isDisabled={!isNumericDtype(col.dtype)}
              inputType="checkbox"
              onChange={onToggle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryState { hasError: boolean; message: string }

class ColumnConfigErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-400">
          <strong>Column configuration failed:</strong> {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * ColumnConfigPanel — lets the user pick a time axis column and one or more
 * signal channel columns before triggering the processing pipeline.
 *
 * @example
 * <ColumnConfigPanel
 *   signalId="abc-123"
 *   onConfigured={() => refresh()}
 *   onCancel={() => setOpen(false)}
 * />
 */
export function ColumnConfigPanel({ signalId, onConfigured, onCancel }: ColumnConfigPanelProps) {
  const uid = useId();
  const timeLabelId = `${uid}-time-label`;
  const sigLabelId  = `${uid}-sig-label`;
  const radioGroup  = `time-col-${uid}`;

  const {
    status, columns, timeCol, sigCols,
    fetchError, submitError, canSubmit,
    setTimeCol, toggleSigCol, handleSubmit,
  } = useColumnConfig(signalId, onConfigured);

  if (status === 'loading') {
    return (
      <div
        className="flex items-center justify-center py-10 gap-2"
        style={{ color: 'var(--sp-text-tertiary)' }}
        role="status"
        aria-label="Loading column information"
      >
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        <span className="text-xs font-sans">Inspecting file columns…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex items-center gap-2 py-4 text-xs font-sans text-red-400">
        <AlertCircle size={14} aria-hidden="true" />
        <span>{fetchError}</span>
        <button
          onClick={onCancel}
          className="ml-auto text-zinc-500 hover:text-zinc-300 text-[10px]"
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const isSubmitting = status === 'submitting';

  return (
    <ColumnConfigErrorBoundary>
      <section className="space-y-4 text-xs font-sans" aria-label="Configure column mapping">
        {/* Header */}
        <div className="flex items-center gap-2" style={{ color: 'var(--sp-text-secondary)' }}>
          <Settings2 size={14} className="text-brand-400" aria-hidden="true" />
          <h2 className="font-semibold text-[11px] uppercase tracking-wide">
            Configure Column Mapping
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TimeColumnSelector
            columns={columns}
            selected={timeCol}
            radioGroupName={radioGroup}
            labelId={timeLabelId}
            onSelect={setTimeCol}
          />
          <SignalColumnSelector
            columns={columns}
            selectedTimeCol={timeCol}
            sigCols={sigCols}
            labelId={sigLabelId}
            onToggle={toggleSigCol}
          />
        </div>

        {/* Inline validation hints */}
        {timeCol && sigCols.has(timeCol) && (
          <div role="alert" className="flex items-center gap-1.5 text-yellow-400 text-[10px]">
            <AlertCircle size={11} aria-hidden="true" />
            The time column cannot also be a signal channel. Deselect it from signals.
          </div>
        )}
        {submitError && (
          <div role="alert" className="flex items-center gap-1.5 text-red-400 text-[10px]">
            <AlertCircle size={11} aria-hidden="true" /> {submitError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-[11px] font-sans rounded transition-colors disabled:opacity-50"
            style={{
              color: 'var(--sp-text-tertiary)',
              background: 'var(--sp-surface-secondary)',
              border: '1px solid var(--sp-border)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            aria-disabled={!canSubmit || isSubmitting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-sans bg-brand-500 hover:bg-blue-400 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              : <ChevronRight size={11} aria-hidden="true" />
            }
            {isSubmitting ? 'Starting…' : 'Process Signal'}
          </button>
        </div>
      </section>
    </ColumnConfigErrorBoundary>
  );
}

export default ColumnConfigPanel;
