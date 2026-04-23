import type { WindowFunction } from '../types/signal';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_FUNCTIONS: { value: WindowFunction; label: string }[] = [
  { value: 'hann',          label: 'Hann' },
  { value: 'hamming',       label: 'Hamming' },
  { value: 'blackman',      label: 'Blackman' },
  { value: 'blackmanharris',label: 'Blackman-Harris' },
  { value: 'flattop',       label: 'Flat Top' },
  { value: 'bartlett',      label: 'Bartlett' },
  { value: 'barthann',      label: 'Bart-Hann' },
  { value: 'bohman',        label: 'Bohman' },
  { value: 'nuttall',       label: 'Nuttall' },
  { value: 'parzen',        label: 'Parzen' },
  { value: 'cosine',        label: 'Cosine' },
  { value: 'tukey',         label: 'Tukey' },
  { value: 'taylor',        label: 'Taylor' },
  { value: 'exponential',   label: 'Exponential' },
  { value: 'boxcar',        label: 'Boxcar (no taper)' },
];

/** Powers-of-2 window sizes available as presets. */
const WINDOW_SIZE_OPTIONS: number[] = [64, 128, 256, 512, 1024, 2048, 4096, 8192];

/** Hop size presets expressed as fractions of the window size. */
const HOP_PRESETS: { label: string; divisor: number }[] = [
  { label: '1/2 overlap', divisor: 2 },
  { label: '3/4 overlap', divisor: 4 },
  { label: '7/8 overlap', divisor: 8 },
  { label: 'No overlap',  divisor: 1 },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WindowConfigControlsProps {
  windowFn: WindowFunction;
  windowSize: number;
  hopSize: number;
  onWindowFnChange: (fn: WindowFunction) => void;
  onWindowSizeChange: (size: number) => void;
  onHopSizeChange: (size: number) => void;
  /** When true, renders hop-size controls (needed for spectrogram). */
  showHopSize?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SELECT_CLS =
  'text-xs font-mono rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-colors';

/**
 * WindowConfigControls — compact row of controls for FFT window parameters.
 *
 * Displays:
 * - Window function select (15 options mirroring backend `WindowFunction`)
 * - Window size select (power-of-2 presets)
 * - Optional hop size controls (for spectrogram mode)
 */
export default function WindowConfigControls({
  windowFn,
  windowSize,
  hopSize,
  onWindowFnChange,
  onWindowSizeChange,
  onHopSizeChange,
  showHopSize = false,
  className = '',
}: WindowConfigControlsProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-4 ${className}`}
      role="group"
      aria-label="FFT window configuration"
    >
      {/* Window function */}
      <label className="flex items-center gap-2">
        <span
          className="text-[10px] font-sans font-semibold uppercase tracking-wide"
          style={{ color: 'var(--sp-text-tertiary)' }}
        >
          Window
        </span>
        <select
          value={windowFn}
          onChange={(e) => onWindowFnChange(e.target.value as WindowFunction)}
          className={SELECT_CLS}
          style={{
            background: 'var(--sp-surface-elevated)',
            border: '1px solid var(--sp-border)',
            color: 'var(--sp-text-primary)',
          }}
          aria-label="Window function"
        >
          {WINDOW_FUNCTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {/* Window size */}
      <label className="flex items-center gap-2">
        <span
          className="text-[10px] font-sans font-semibold uppercase tracking-wide"
          style={{ color: 'var(--sp-text-tertiary)' }}
        >
          FFT size
        </span>
        <select
          value={windowSize}
          onChange={(e) => onWindowSizeChange(Number(e.target.value))}
          className={SELECT_CLS}
          style={{
            background: 'var(--sp-surface-elevated)',
            border: '1px solid var(--sp-border)',
            color: 'var(--sp-text-primary)',
          }}
          aria-label="FFT window size"
        >
          {WINDOW_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} samples
            </option>
          ))}
        </select>
      </label>

      {/* Hop size (spectrogram only) */}
      {showHopSize && (
        <label className="flex items-center gap-2">
          <span
            className="text-[10px] font-sans font-semibold uppercase tracking-wide"
            style={{ color: 'var(--sp-text-tertiary)' }}
          >
            Hop
          </span>
          <select
            value={hopSize}
            onChange={(e) => onHopSizeChange(Number(e.target.value))}
            className={SELECT_CLS}
            style={{
              background: 'var(--sp-surface-elevated)',
              border: '1px solid var(--sp-border)',
              color: 'var(--sp-text-primary)',
            }}
            aria-label="Spectrogram hop size"
          >
            {HOP_PRESETS.map(({ label, divisor }) => {
              const hopVal = Math.max(1, Math.floor(windowSize / divisor));
              return (
                <option key={divisor} value={hopVal}>
                  {hopVal} ({label})
                </option>
              );
            })}
          </select>
        </label>
      )}
    </div>
  );
}
