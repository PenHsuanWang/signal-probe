// TypeScript interfaces mirroring backend Pydantic schemas

export type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
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
  created_at: string;
  updated_at: string;
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
