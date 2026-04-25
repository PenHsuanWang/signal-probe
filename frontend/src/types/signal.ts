// TypeScript interfaces mirroring backend Pydantic schemas

export type ProcessingStatus =
  | "AWAITING_CONFIG"
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";
export type SignalState = "IDLE" | "ACTIVE";

export interface SignalMetadata {
  id: string;
  original_filename: string;
  status: ProcessingStatus;
  total_points: number | null;
  active_run_count: number;
  error_message: string | null;
  channel_names: string[];
  /** Populated after the user selects a column config (EPIC-FLX) */
  time_column: string | null;
  signal_columns: string[] | null;
  created_at: string;
  updated_at: string;
}

// ── Column selection (EPIC-FLX) ──────────────────────────────────────────────

export interface ColumnDescriptor {
  name: string;
  dtype: string;
  null_count: number;
  sample_values: string[];
  is_candidate_time: boolean;
}

export interface RawColumnsResponse {
  signal_id: string;
  columns: ColumnDescriptor[];
  /** Detected CSV format: 'wide' (one column per channel) or 'stacked' (long format). */
  csv_format: 'wide' | 'stacked';
  /** Unique signal names from the signal_name column (stacked format only). */
  stacked_signal_names: string[];
}

export interface ProcessSignalRequest {
  /** CSV format to process. Defaults to 'wide'. */
  csv_format?: 'wide' | 'stacked';
  /** Time axis column name (required for wide format). */
  time_column?: string;
  /** Signal channel column names (required for wide format). */
  signal_columns?: string[];
  /** Signal names to include from a stacked CSV (null/omit = all channels). */
  stacked_channel_filter?: string[] | null;
  /**
   * Explicit datetime column name override (stacked format).
   * When omitted the backend falls back to alias detection.
   */
  datetime_column?: string;
  /**
   * Column whose values contain the physical unit string for each row
   * (e.g. "mV", "°C"). Present in both wide and stacked formats.
   * When omitted no unit labels are attached to the y-axis.
   */
  unit_column?: string;
}

export interface RunBound {
  run_id: string;
  run_index: number;
  start_x: number;
  end_x: number;
}

// ── Multi-channel ────────────────────────────────────────────────────────────

export interface ChannelMacroData {
  channel_name: string;
  y: number[];
  states: SignalState[];
}

export interface MacroViewResponse {
  signal_id: string;
  x: number[];
  channels: ChannelMacroData[];
  runs: RunBound[];
  /**
   * Unix epoch seconds of the first timestamp.
   * Present when the time column is temporal; null for numeric time axes.
   * Reconstruct absolute datetime for index i as: new Date((t0_epoch_s + x[i]) * 1000)
   */
  t0_epoch_s: number | null;
  /**
   * Physical unit string per channel (e.g. { "voltage": "mV", "temp": "°C" }).
   * Present when a unit column was selected during processing; omitted otherwise.
   */
  channel_units?: Record<string, string>;
}

export interface ChannelChunkData {
  channel_name: string;
  y: number[];
  states: SignalState[];
}

export interface RunChunkResponse {
  run_id: string;
  run_index: number;
  duration_seconds: number | null;
  value_max: number | null;
  value_min: number | null;
  value_mean: number | null;
  value_variance: number | null;
  x: number[];
  channels: ChannelChunkData[];
}

// ── Groups ───────────────────────────────────────────────────────────────────

export interface GroupMember {
  id: string;
  signal_id: string;
  display_order: number;
  channel_colors: Record<string, string>;
  time_offset_s: number;
}

export interface Group {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  members: GroupMember[];
  created_at: string;
  updated_at: string;
}

export interface GroupCreateRequest {
  name: string;
  description?: string | null;
}

export interface GroupUpdateRequest {
  name?: string | null;
  description?: string | null;
}

export interface GroupMemberUpsert {
  signal_id: string;
  display_order?: number;
  channel_colors?: Record<string, string>;
  time_offset_s?: number;
}

// ── STFT Analysis (Feature 8) ─────────────────────────────────────────────────

export type WindowFunction =
  | 'hann'
  | 'hamming'
  | 'blackman'
  | 'blackmanharris'
  | 'nuttall'
  | 'flattop'
  | 'boxcar'
  | 'triang'
  | 'bartlett'
  | 'bartlett_hann'
  | 'bohman'
  | 'cosine'
  | 'lanczos'
  | 'tukey'
  | 'exponential';

export interface STFTWindowConfig {
  start_s: number;
  end_s: number;
  window_fn: WindowFunction;
  window_size: number;
}

export interface STFTResponse {
  signal_id: string;
  channel_name: string;
  frequencies_hz: number[];
  magnitudes: number[];
  dominant_frequency_hz: number | null;
  window_config: STFTWindowConfig;
  sampling_rate_hz: number;
}

export interface SpectrogramResponse {
  signal_id: string;
  channel_name: string;
  time_bins_s: number[];
  frequency_bins_hz: number[];
  magnitude_db: number[][];
  sampling_rate_hz: number;
  downsampled: boolean;
}

export interface ExplorationWindow {
  start_s: number;
  end_s: number;
}

export type ExplorationPhase =
  | 'idle'
  | 'exploring'
  | 'locked'
  | 'generating'
  | 'spectrogram_ready';
