import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 15000,
});

export interface Endpoint {
  id: string;
  name: string;
  slug: string;
  hmacSecret?: string;
  createdAt: string;
  _count?: { events: number };
}

export interface WebhookEvent {
  id: string;
  endpointId: string;
  method: string;
  headers: string;
  rawBody: string;
  redactedBody: string;
  sourceIp: string;
  hmacStatus: 'VERIFIED' | 'TAMPERED' | 'UNVERIFIED';
  schemaMutation: string | null;
  traceId: string;
  receivedAt: string;
  replays?: ReplayLog[];
}

export interface ReplayLog {
  id: string;
  eventId: string;
  targetUrl: string;
  delayMs: number;
  chaosMode: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  latencyMs: number | null;
  success: boolean;
  replayedAt: string;
}

export interface SchemaMutation {
  added: string[];
  removed: string[];
  typeMutated: { field: string; from: string; to: string }[];
}

export interface Snippets {
  curl: string;
  nodeFetch: string;
  python: string;
}

// Endpoints API
export const endpointsApi = {
  list: () => api.get<Endpoint[]>('/endpoints'),
  create: (data: { name: string; hmacSecret?: string }) => api.post<Endpoint>('/endpoints', data),
  delete: (id: string) => api.delete(`/endpoints/${id}`),
};

// Events API
export const eventsApi = {
  listByEndpoint: (endpointId: string) =>
    api.get<WebhookEvent[]>(`/events/endpoint/${endpointId}`),
  get: (id: string) => api.get<WebhookEvent>(`/events/${id}`),
  getSnippets: (id: string) => api.get<Snippets>(`/events/${id}/snippets`),
  delete: (id: string) => api.delete(`/events/${id}`),
  clearAll: (endpointId: string) =>
    api.delete<{ deletedCount: number }>(`/events/endpoint/${endpointId}`),
};

// Direct Ingest API (used by simulator)
export const ingestApi = {
  send: (endpointId: string, payload: any, headers?: Record<string, string>) =>
    axios.post(`${API_URL}/api/v1/ingest/${endpointId}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
    }),
};

// Replay API
export const replayApi = {
  replay: (eventId: string, payload: {
    targetUrl: string;
    delayMs?: number;
    chaosMode?: string | null;
    customBody?: string;
    customHeaders?: Record<string, string>;
  }) => api.post(`/replay/${eventId}`, payload),
  getLogs: (eventId: string) => api.get<ReplayLog[]>(`/replay/logs/${eventId}`),
};
