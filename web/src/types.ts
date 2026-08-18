// Mirrors docs/API.md — keep in sync with the orchestrator.

export type AgentStatus = 'idle' | 'working' | 'needs_attention';
export type ComputerState = 'starting' | 'running' | 'stopped' | 'error';

export interface Agent {
  id: string;
  name: string;
  title: string;
  description: string;
  provider: string;
  model: string;
  color: string;
  status: AgentStatus;
  computerState: ComputerState;
  memory: string;
  createdAt: string;
}

export type MessageRole =
  | 'user'
  | 'assistant'
  | 'peer_in'
  | 'peer_out'
  | 'activity'
  | 'system';

export interface Message {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  senderAgentId?: string;
  senderName?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export type ActivityKind =
  | 'screenshot'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'move'
  | 'scroll'
  | 'type'
  | 'key'
  | 'wait'
  | 'exec'
  | 'remember'
  | 'thought';

export interface Activity {
  kind: ActivityKind;
  summary: string;
  detail?: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  models: string[];
  hasKey: boolean;
  needsKey: boolean;
  needsBaseUrl: boolean;
}

export interface SettingsView {
  keys: Record<string, { set: boolean }>;
  baseUrls: Record<string, string>;
}

export interface SettingsPatch {
  keys?: Record<string, string>;
  baseUrls?: Record<string, string>;
}

/** Body of POST /api/agents; PATCH takes any subset. */
export interface AgentInput {
  name: string;
  title: string;
  description: string;
  provider: string;
  model: string;
  color: string;
}

export type WsEvent =
  | { type: 'hello'; agents: Agent[] }
  | { type: 'agent_created'; agent: Agent }
  | { type: 'agent_updated'; agent: Agent }
  | { type: 'agent_deleted'; agentId: string }
  | { type: 'message'; message: Message };
