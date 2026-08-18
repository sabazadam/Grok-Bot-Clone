import type { Agent, Approval, Conversation, MemoryEntry, Message, Provider } from "@grokbot/shared";

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
  startComputer: (id: string) => req(`/api/agents/${id}/computer/start`, { method: "POST" }),
  stopComputer: (id: string) => req(`/api/agents/${id}/computer/stop`, { method: "POST" }),
  restartComputer: (id: string) => req(`/api/agents/${id}/computer/restart`, { method: "POST" }),
  memories: (agentId: string) => req<MemoryEntry[]>(`/api/agents/${agentId}/memories`),
  deleteMemory: (id: string) => req(`/api/memories/${id}`, { method: "DELETE" }),
  conversations: () => req<Conversation[]>("/api/conversations"),
  createGroup: (title: string, agentIds: string[]) =>
    req<Conversation>("/api/conversations", { method: "POST", body: JSON.stringify({ title, agentIds }) }),
  deleteConversation: (id: string) => req(`/api/conversations/${id}`, { method: "DELETE" }),
  messages: (convId: string) => req<Message[]>(`/api/conversations/${convId}/messages`),
  sendMessage: (convId: string, text: string) =>
    req<Message>(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  approve: (approvalId: string) => req<Approval>(`/api/approvals/${approvalId}/approve`, { method: "POST" }),
  reject: (approvalId: string) => req<Approval>(`/api/approvals/${approvalId}/reject`, { method: "POST" }),
  cancelTask: (taskId: string) => req(`/api/tasks/${taskId}/cancel`, { method: "POST" }),
};
