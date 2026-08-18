import type {
  Agent,
  AgentInput,
  Message,
  ProviderInfo,
  SettingsPatch,
  SettingsView,
  WsEvent,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  listAgents: () => request<Agent[]>('/api/agents'),

  createAgent: (input: AgentInput) =>
    request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(input) }),

  getAgent: (id: string) => request<Agent>(`/api/agents/${id}`),

  updateAgent: (id: string, patch: Partial<AgentInput>) =>
    request<Agent>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteAgent: (id: string) =>
    request<{ ok: true }>(`/api/agents/${id}`, { method: 'DELETE' }),

  getMessages: (id: string, limit = 100) =>
    request<Message[]>(`/api/agents/${id}/messages?limit=${limit}`),

  sendMessage: (id: string, content: string) =>
    request<{ ok: true }>(`/api/agents/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  stopAgent: (id: string) =>
    request<{ ok: true }>(`/api/agents/${id}/stop`, { method: 'POST' }),

  restartComputer: (id: string) =>
    request<{ ok: true }>(`/api/agents/${id}/computer/restart`, { method: 'POST' }),

  getProviders: () => request<ProviderInfo[]>('/api/providers'),

  getSettings: () => request<SettingsView>('/api/settings'),

  putSettings: (patch: SettingsPatch) =>
    request<SettingsView>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
};

/** Absolute ws(s):// URL for a same-origin websocket path. */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

export interface EventsClientOptions {
  onEvent: (event: WsEvent) => void;
  /** Called on every successful open; isReconnect is false only for the first one. */
  onOpen: (isReconnect: boolean) => void;
  onStatus?: (connected: boolean) => void;
}

/**
 * Connect to the /ws event stream. Reconnects forever with exponential
 * backoff (1s → 15s cap). Returns a dispose function.
 */
export function connectEvents(options: EventsClientOptions): () => void {
  let closed = false;
  let attempt = 0;
  let openCount = 0;
  let socket: WebSocket | null = null;
  let timer: number | undefined;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(wsUrl('/ws'));

    socket.onopen = () => {
      attempt = 0;
      options.onStatus?.(true);
      options.onOpen(openCount > 0);
      openCount += 1;
    };

    socket.onmessage = (ev) => {
      let parsed: WsEvent;
      try {
        parsed = JSON.parse(ev.data as string) as WsEvent;
      } catch {
        return;
      }
      options.onEvent(parsed);
    };

    socket.onclose = () => {
      socket = null;
      options.onStatus?.(false);
      if (closed) return;
      const delay = Math.min(15000, 1000 * 2 ** attempt);
      attempt = Math.min(attempt + 1, 4);
      timer = window.setTimeout(connect, delay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    socket?.close();
  };
}
