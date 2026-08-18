/** Persistent domain entities shared between server and web UI. */

export type Provider = "anthropic" | "openai" | "google" | "generic";

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  google: "Google (Gemini)",
  generic: "Generic / xAI (OpenAI-compatible)",
};

/** Recommended computer-use-capable default model per provider (editable per agent). */
export const PROVIDER_DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "computer-use-preview",
  google: "gemini-2.5-computer-use-preview-10-2025",
  generic: "grok-4",
};

export type AgentStatus = "off" | "starting" | "idle" | "working" | "waiting_approval" | "error";

export interface Agent {
  id: string;
  name: string;
  roleTitle: string;
  /** Standing instructions / job description / boundaries. Part of the system prompt. */
  instructions: string;
  avatarColor: string;
  provider: Provider;
  model: string;
  /** May this agent message other agents? */
  collaborationEnabled: boolean;
  status: AgentStatus;
  /** Host ports of this agent's computer, when provisioned */
  computer?: ComputerInfo;
  createdAt: number;
}

export interface ComputerInfo {
  containerId: string | null;
  state: "none" | "creating" | "running" | "stopped" | "error";
  novncPort: number | null;
  actuatorPort: number | null;
  resolution: string;
  lastError?: string;
}

export type ConversationKind = "direct" | "agent_dm" | "group";

export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** Display name; for direct chats it's the agent name, groups have custom names */
  title: string;
  /** agent ids participating (user is implicit in direct/group) */
  agentIds: string[];
  createdAt: number;
  lastMessageAt: number;
}

export type MessageSender =
  | { kind: "user" }
  | { kind: "agent"; agentId: string }
  | { kind: "system" };

export type MessageKind =
  | "text"
  | "activity" // collapsed action caption e.g. clicked/typed/ran command
  | "approval_request"
  | "error";

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  /** for approval_request messages */
  approvalId?: string;
  /** optional path of a step screenshot associated with an activity */
  screenshotUrl?: string;
  createdAt: number;
}

export type TaskStatus = "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
  agentId: string;
  conversationId: string;
  prompt: string;
  status: TaskStatus;
  stepCount: number;
  resultSummary?: string;
  createdAt: number;
  finishedAt?: number;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  taskId: string;
  agentId: string;
  conversationId: string;
  /** human-readable description of the exact pending action */
  actionDescription: string;
  /** JSON of the pending action so it can be executed on approve */
  actionJson: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: number;
}

export type MemoryKind = "preference" | "fact" | "summary";

export interface MemoryEntry {
  id: string;
  agentId: string;
  kind: MemoryKind;
  content: string;
  createdAt: number;
}
