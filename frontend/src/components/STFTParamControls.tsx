import type { ExplorationPhase, WindowFunction } from '../types/signal';

const WINDOW_FUNCTIONS: { value: WindowFunction; label: string }[] = [
  { value: 'hann', label: 'Hann' },
  { value: 'hamming', label: 'Hamming' },
  { value: 'blackman', label: 'Blackman' },
  { value: 'blackmanharris', label: 'Blackman-Harris' },
  { value: 'nuttall', label: 'Nuttall' },
  { value: 'flattop', label: 'Flat Top' },
  { value: 'boxcar', label: 'Boxcar (rectangular)' },
  { value: 'triang', label: 'Triangular' },
  { value: 'bartlett', label: 'Bartlett' },
  { value: 'bartlett_hann', label: 'Bartlett-Hann' },
  { value: 'bohman', label: 'Bohman' },
  { value: 'cosine', label: 'Cosine' },
  { value: 'lanczos', label: 'Lanczos (sinc)' },
  { value: 'tukey', label: 'Tukey' },
  { value: 'exponential', label: 'Exponential' },
];

interface Props {
  phase: ExplorationPhase;
  windowFn: WindowFunction;
  windowSize: number | null;
  lockedWindowSize: number | null;
  overlapPct: number;
  hopSize: number;
  samplingRateHz: number;
  totalDuration: number;
  spectrogramLoading: boolean;
  onSetWindowFn: (fn: WindowFunction) => void;
  onLockWindow: () => void;
  onUnlockWindow: () => void;
  onSetOverlapPct: (pct: number) => void;
  onGenerateSpectrogram: () => void;
}

export default function STFTParamControls({
  phase,
  windowFn,
  windowSize,
  lockedWindowSize,
  overlapPct,
  hopSize,
  samplingRateHz,
  totalDuration,
  spectrogramLoading,
  onSetWindowFn,
  onLockWindow,
  onUnlockWindow,
  onSetOverlapPct,
  onGenerateSpectrogram,
}: Props) {
  const isLocked = phase === 'locked' || phase === 'generating' || phase === 'spectrogram_ready';
  const canLock = phase === 'exploring' && windowSize != null;
  const canGenerate = (phase === 'locked' || phase === 'spectrogram_ready') && !spectrogramLoading;

  const totalSamples = Math.round(totalDuration * samplingRateHz);
  const nWindows = hopSize > 0 ? Math.ceil(totalSamples / hopSize) : 0;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Window function selector */}
      <div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-wide mb-1"
               style={{ color: 'var(--sp-text-tertiary)' }}>
          Window Function
        </label>
        <select
          aria-label="Window function"
          value={windowFn}
          onChange={(e) => onSetWindowFn(e.target.value as WindowFunction)}
          className="w-full rounded text-xs font-sans px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-all"
          style={{
            background: 'var(--sp-surface-primary)',
            border: '1px solid var(--sp-border)',
            color: 'var(--sp-text-primary)',
          }}
        >
          {WINDOW_FUNCTIONS.map((wf) => (
            <option key={wf.value} value={wf.value}>{wf.label}</option>
          ))}
        </select>
      </div>

      {/* Lock / Unlock button */}
      <div>
        {isLocked ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-green-400">
              ✓ Locked: {lockedWindowSize} samples
            </span>
            {phase !== 'generating' && (
              <button
                onClick={onUnlockWindow}
                className="text-[10px] font-sans text-zinc-500 hover:text-zinc-300 transition-colors underline"
                aria-label="Unlock window size"
              >
                Unlock
              </button>
            )}
          </div>
        ) : (
          <button
            disabled={!canLock}
            onClick={onLockWindow}
            className={`w-full py-1.5 rounded text-xs font-sans font-semibold transition-colors
              ${canLock
                ? 'bg-brand-500 hover:bg-blue-400 text-white'
                : 'opacity-40 cursor-default text-zinc-400'
              }`}
            style={!canLock ? { background: 'var(--sp-surface-elevated)' } : {}}
            aria-label="Lock window size"
          >
            Lock Window Size {windowSize != null ? `(${windowSize})` : ''}
          </button>
        )}
      </div>

      {/* Overlap controls — only active when locked */}
      <div className={`flex flex-col gap-1.5 transition-opacity ${isLocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-sans font-semibold uppercase tracking-wide"
                 style={{ color: 'var(--sp-text-tertiary)' }}>
            Overlap
          </label>
          <span className="text-xs font-mono" style={{ color: 'var(--sp-text-secondary)' }}>
            {overlapPct}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={95}
          step={5}
          value={overlapPct}
          onChange={(e) => onSetOverlapPct(Number(e.target.value))}
          aria-label="Overlap percentage"
          aria-valuenow={overlapPct}
          className="w-full accent-brand-500"
        />
        <div className="flex flex-col gap-0.5 text-[10px] font-mono"
             style={{ color: 'var(--sp-text-tertiary)' }}>
          <span>
            hop_size: <span style={{ color: 'var(--sp-text-secondary)' }}>{hopSize}</span> samples
          </span>
          {nWindows > 0 && (
            <span>
              ~<span style={{ color: 'var(--sp-text-secondary)' }}>{nWindows.toLocaleString()}</span> windows
            </span>
          )}
        </div>
      </div>

      {/* Generate button */}
      <div className="mt-auto">
        <button
          disabled={!canGenerate}
          onClick={onGenerateSpectrogram}
          className={`w-full py-2 rounded text-xs font-sans font-semibold flex items-center justify-center gap-2 transition-colors
            ${canGenerate
              ? 'bg-green-600 hover:bg-green-500 text-white'
              : 'opacity-40 cursor-default text-zinc-400'
            }`}
          style={!canGenerate ? { background: 'var(--sp-surface-elevated)' } : {}}
          aria-label="Generate spectrogram"
        >
          {spectrogramLoading ? (
            <span className="animate-spin text-base leading-none">⊙</span>
          ) : (
            '▶'
          )}
          {spectrogramLoading ? 'Generating…' : 'Generate Spectrogram'}
        </button>
      </div>
    </div>
  );
}
