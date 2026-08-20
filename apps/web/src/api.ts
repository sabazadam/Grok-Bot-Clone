import type {
  Agent,
  Approval,
  Conversation,
  MemoryEntry,
  Message,
  Plugin,
  Provider,
  Routine,
  SearchHit,
  Skill,
} from "@grokbot/shared";

export interface IncomingAttachment {
  name: string;
  mime: string;
  dataBase64: string;
}

export interface TeachSession {
  agentId: string;
  name: string;
  notes: string;
  startedAt: number;
  shots: string[];
}

export interface ProviderInfo {
  id: Provider;
  label: string;
  hasKey: boolean;
  defaultModel: string;
}

export interface AppConfig {
  providers: ProviderInfo[];
  dockerAvailable: boolean;
  imageAvailable: boolean;
  maxRunningComputers: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  config: () => req<AppConfig>("/api/config"),
  agents: () => req<Agent[]>("/api/agents"),
  createAgent: (body: unknown) => req<Agent>("/api/agents", { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (id: string, body: unknown) => req<Agent>(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAgent: (id: string, deleteData: boolean) =>
    req<{ ok: boolean }>(`/api/agents/${id}?deleteData=${deleteData ? "1" : "0"}`, { method: "DELETE" }),
  duplicateAgent: (id: string) => req<Agent>(`/api/agents/${id}/duplicate`, { method: "POST" }),
  hideAgent: (id: string, hidden: boolean) =>
    req<Agent>(`/api/agents/${id}/hide`, { method: "POST", body: JSON.stringify({ hidden }) }),
  startComputer: (id: string) => req(`/api/agents/${id}/computer/start`, { method: "POST" }),
  stopComputer: (id: string) => req(`/api/agents/${id}/computer/stop`, { method: "POST" }),
  restartComputer: (id: string) => req(`/api/agents/${id}/computer/restart`, { method: "POST" }),
  setTakeover: (id: string, active: boolean) =>
    req(`/api/agents/${id}/takeover`, { method: "POST", body: JSON.stringify({ active }) }),
  clearTakeovers: () => req<{ ok: boolean; released: string[] }>("/api/takeovers/clear", { method: "POST" }),
  memories: (agentId: string) => req<MemoryEntry[]>(`/api/agents/${agentId}/memories`),
  deleteMemory: (id: string) => req(`/api/memories/${id}`, { method: "DELETE" }),
  conversations: () => req<Conversation[]>("/api/conversations"),
  createGroup: (title: string, agentIds: string[]) =>
    req<Conversation>("/api/conversations", { method: "POST", body: JSON.stringify({ title, agentIds }) }),
  deleteConversation: (id: string) => req(`/api/conversations/${id}`, { method: "DELETE" }),
  messages: (convId: string) => req<Message[]>(`/api/conversations/${convId}/messages`),
  approvals: (convId: string) => req<Approval[]>(`/api/conversations/${convId}/approvals`),
  sendMessage: (convId: string, text: string, attachments?: IncomingAttachment[]) =>
    req<Message>(`/api/conversations/${convId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, attachments }),
    }),
  pinConversation: (id: string, pinned: boolean) =>
    req<Conversation>(`/api/conversations/${id}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }),
  react: (messageId: string, emoji: string) =>
    req<Message>(`/api/messages/${messageId}/react`, { method: "POST", body: JSON.stringify({ emoji }) }),
  search: (q: string) => req<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  plugins: () => req<Plugin[]>("/api/plugins"),
  createPlugin: (body: unknown) => req<Plugin>("/api/plugins", { method: "POST", body: JSON.stringify(body) }),
  updatePlugin: (id: string, body: unknown) => req<Plugin>(`/api/plugins/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePlugin: (id: string) => req<{ ok: boolean }>(`/api/plugins/${id}`, { method: "DELETE" }),
  teachSession: (agentId: string) => req<{ session: TeachSession | null }>(`/api/agents/${agentId}/teach`),
  teachStart: (agentId: string, name: string, notes: string) =>
    req<TeachSession>(`/api/agents/${agentId}/teach/start`, { method: "POST", body: JSON.stringify({ name, notes }) }),
  teachStop: (agentId: string, save: boolean) =>
    req<{ ok: boolean; skill?: Skill; session: TeachSession | null }>(`/api/agents/${agentId}/teach/stop`, {
      method: "POST",
      body: JSON.stringify({ save }),
    }),
  stopConversation: (convId: string) => req<{ ok: boolean }>(`/api/conversations/${convId}/stop`, { method: "POST" }),
  skills: () => req<Skill[]>("/api/skills"),
  createSkill: (body: unknown) => req<Skill>("/api/skills", { method: "POST", body: JSON.stringify(body) }),
  deleteSkill: (id: string) => req<{ ok: boolean }>(`/api/skills/${id}`, { method: "DELETE" }),
  agentSkills: (agentId: string) => req<(Skill & { enabled: boolean })[]>(`/api/agents/${agentId}/skills`),
  setAgentSkill: (agentId: string, skillId: string, enabled: boolean) =>
    req<{ ok: boolean }>(`/api/agents/${agentId}/skills`, { method: "POST", body: JSON.stringify({ skillId, enabled }) }),
  routines: (agentId?: string) => req<Routine[]>(agentId ? `/api/routines?agentId=${agentId}` : "/api/routines"),
  createRoutine: (body: unknown) => req<Routine>("/api/routines", { method: "POST", body: JSON.stringify(body) }),
  updateRoutine: (id: string, body: unknown) => req<Routine>(`/api/routines/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRoutine: (id: string) => req<{ ok: boolean }>(`/api/routines/${id}`, { method: "DELETE" }),
  runRoutine: (id: string) => req<{ ok: boolean }>(`/api/routines/${id}/run`, { method: "POST" }),
  approve: (approvalId: string) => req<Approval>(`/api/approvals/${approvalId}/approve`, { method: "POST" }),
  reject: (approvalId: string) => req<Approval>(`/api/approvals/${approvalId}/reject`, { method: "POST" }),
  cancelTask: (taskId: string) => req(`/api/tasks/${taskId}/cancel`, { method: "POST" }),
};
