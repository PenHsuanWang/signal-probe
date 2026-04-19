import axios from 'axios';
import type { MacroViewResponse, RunChunkResponse, SignalMetadata } from '../types/signal';

export const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ── Signal API helpers ─────────────────────────────────────────────────────

export async function uploadSignal(file: File): Promise<SignalMetadata> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<SignalMetadata>('/signals/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function listSignals(): Promise<SignalMetadata[]> {
  const res = await api.get<SignalMetadata[]>('/signals');
  return res.data;
}

export async function getSignal(id: string): Promise<SignalMetadata> {
  const res = await api.get<SignalMetadata>(`/signals/${id}`);
  return res.data;
}

export async function getMacroView(id: string): Promise<MacroViewResponse> {
  const res = await api.get<MacroViewResponse>(`/signals/${id}/macro`);
  return res.data;
}

export async function getRunChunks(
  signalId: string,
  runIds: string[]
): Promise<RunChunkResponse[]> {
  const params = new URLSearchParams();
  runIds.forEach((id) => params.append('run_ids', id));
  const res = await api.get<RunChunkResponse[]>(`/signals/${signalId}/runs?${params}`);
  return res.data;
}
