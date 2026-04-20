import axios from 'axios';
import type {
  Group,
  GroupCreateRequest,
  GroupMemberUpsert,
  GroupUpdateRequest,
  MacroViewResponse,
  RunChunkResponse,
  SignalMetadata,
} from '../types/signal';

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

// ── Signal API helpers ──────────────────────────────────────────────────────

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

export async function renameSignal(id: string, newFilename: string): Promise<SignalMetadata> {
  const res = await api.patch<SignalMetadata>(`/signals/${id}`, {
    original_filename: newFilename,
  });
  return res.data;
}

export async function deleteSignal(id: string): Promise<void> {
  await api.delete(`/signals/${id}`);
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

// ── Group API helpers ───────────────────────────────────────────────────────

export async function listGroups(): Promise<Group[]> {
  const res = await api.get<Group[]>('/groups');
  return res.data;
}

export async function createGroup(body: GroupCreateRequest): Promise<Group> {
  const res = await api.post<Group>('/groups', body);
  return res.data;
}

export async function updateGroup(id: string, body: GroupUpdateRequest): Promise<Group> {
  const res = await api.patch<Group>(`/groups/${id}`, body);
  return res.data;
}

export async function deleteGroup(id: string): Promise<void> {
  await api.delete(`/groups/${id}`);
}

export async function upsertGroupMember(
  groupId: string,
  body: GroupMemberUpsert
): Promise<void> {
  await api.put(`/groups/${groupId}/members`, body);
}

export async function removeGroupMember(
  groupId: string,
  signalId: string
): Promise<void> {
  await api.delete(`/groups/${groupId}/members/${signalId}`);
}
