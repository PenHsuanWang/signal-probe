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

export interface MacroViewResponse {
  signal_id: string;
  x: number[];
  y: number[];
  states: SignalState[];
  runs: RunBound[];
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
  y: number[];
  states: SignalState[];
}
