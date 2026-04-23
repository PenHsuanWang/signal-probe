import { useMemo } from 'react';
import type { MacroViewResponse, SignalMetadata } from '../types/signal';
import type { Theme } from '../context/ThemeContext';
import { useSTFT } from '../hooks/useSTFT';
import WindowConfigControls from './WindowConfigControls';
import TimeSignalWithWindow from './TimeSignalWithWindow';
import SpectrumChart from './SpectrumChart';
import SpectrogramHeatmap from './SpectrogramHeatmap';

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

import { Component, type ReactNode } from 'react';

interface EBState { hasError: boolean; message: string }
class STFTPanelErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false, message: '' };
  static getDerivedStateFromError(err: Error): EBState {
    return { hasError: true, message: err.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-lg border border-red-500/20 p-4 text-xs font-sans text-red-400"
        >
          <strong>Spectral analysis error:</strong> {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  signal: SignalMetadata;
  macro: MacroViewResponse;
  theme: Theme;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SELECT_CLS =
  'text-xs font-mono rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-colors';

/**
 * STFTPanel — full STFT analysis layout for a single signal.
 *
 * Layout (top → bottom):
 *   1. Channel selector + WindowConfigControls
 *   2. TimeSignalWithWindow  (time-domain view with draggable window)
 *   3. SpectrumChart (left) + SpectrogramHeatmap (right)
 */
export default function STFTPanel({ signal, macro, theme }: Props) {
  const {
    channelName,
    windowFn,
    windowSize,
    startS,
    endS,
    hopSize,
    stftStatus,
    spectrum,
    stftError,
    spectrogramStatus,
    spectrogram,
    spectrogramError,
    setChannel,
    setWindowFn,
    setWindowSize,
    setHopSize,
    setWindowBounds,
    computeSpectrogram,
    clearSpectrogram,
  } = useSTFT(signal.id);

  const channelOptions = useMemo(
    () => signal.channel_names ?? [],
    [signal.channel_names],
  );

  // Auto-select first channel when options become available and none is chosen.
  const effectiveChannel = channelName ?? channelOptions[0] ?? null;

  return (
    <STFTPanelErrorBoundary>
      <div className="space-y-4">

        {/* ── Controls row ─────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap items-center gap-4 rounded-lg px-4 py-3"
          style={{
            background: 'var(--sp-surface-secondary)',
            border: '1px solid var(--sp-border)',
          }}
        >
          {/* Channel selector */}
          <label className="flex items-center gap-2">
            <span
              className="text-[10px] font-sans font-semibold uppercase tracking-wide"
              style={{ color: 'var(--sp-text-tertiary)' }}
            >
              Channel
            </span>
            <select
              value={effectiveChannel ?? ''}
              onChange={(e) => setChannel(e.target.value)}
              className={SELECT_CLS}
              style={{
                background: 'var(--sp-surface-elevated)',
                border: '1px solid var(--sp-border)',
                color: 'var(--sp-text-primary)',
              }}
              aria-label="Signal channel to analyse"
            >
              {channelOptions.length === 0 && (
                <option value="">No channels</option>
              )}
              {channelOptions.map((ch) => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>
          </label>

          <WindowConfigControls
            windowFn={windowFn}
            windowSize={windowSize}
            hopSize={hopSize}
            onWindowFnChange={setWindowFn}
            onWindowSizeChange={setWindowSize}
            onHopSizeChange={setHopSize}
            showHopSize
          />
        </div>

        {/* ── Time-domain signal with draggable window ─────────────────── */}
        {effectiveChannel && macro ? (
          <div
            className="rounded-lg overflow-hidden"
            style={{
              background: 'var(--sp-surface-secondary)',
              border: '1px solid var(--sp-border)',
            }}
          >
            <p
              className="px-4 py-2 text-[10px] font-sans"
              style={{ color: 'var(--sp-text-tertiary)', borderBottom: '1px solid var(--sp-border)' }}
            >
              Drag the highlighted region to set the analysis window.
            </p>
            <TimeSignalWithWindow
              macro={macro}
              channelName={effectiveChannel}
              startS={startS}
              endS={endS}
              theme={theme}
              onWindowChange={setWindowBounds}
            />
          </div>
        ) : (
          <div
            className="rounded-lg px-4 py-6 text-center text-xs font-sans"
            style={{
              background: 'var(--sp-surface-secondary)',
              border: '1px solid var(--sp-border)',
              color: 'var(--sp-text-tertiary)',
            }}
          >
            Select a channel above to begin analysis.
          </div>
        )}

        {/* ── Spectrum + Spectrogram ────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: spectrum */}
          <div
            className="rounded-lg p-3"
            style={{
              background: 'var(--sp-surface-secondary)',
              border: '1px solid var(--sp-border)',
            }}
          >
            <SpectrumChart
              spectrum={spectrum}
              status={stftStatus}
              error={stftError}
              theme={theme}
            />
          </div>

          {/* Right: spectrogram */}
          <div
            className="rounded-lg p-3"
            style={{
              background: 'var(--sp-surface-secondary)',
              border: '1px solid var(--sp-border)',
            }}
          >
            <SpectrogramHeatmap
              spectrogram={spectrogram}
              status={spectrogramStatus}
              error={spectrogramError}
              theme={theme}
              canCompute={effectiveChannel != null}
              onCompute={computeSpectrogram}
              onClear={clearSpectrogram}
            />
          </div>
        </div>

      </div>
    </STFTPanelErrorBoundary>
  );
}
