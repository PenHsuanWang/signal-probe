// TypeScript interfaces mirroring backend Pydantic schemas

export type ProcessingStatus =
  | "AWAITING_CONFIG"
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";
export type SignalState = "IDLE" | "ACTIVE" | "OOC";

export interface SignalMetadata {
  id: string;
  original_filename: string;
  status: ProcessingStatus;
  total_points: number | null;
  active_run_count: number;
  ooc_count: number;
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
}

export interface RunBound {
  run_id: string;
  run_index: number;
  start_x: number;
  end_x: number;
  ooc_count: number;
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
  ooc_count: number;
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
