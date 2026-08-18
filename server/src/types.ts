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

/** Internal row shape; not exposed over the API. */
export interface AgentRow extends Agent {
  containerId: string | null;
  actionPort: number | null;
  vncPort: number | null;
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

export interface Activity {
  kind:
    | 'screenshot'
    | 'click'
    | 'double_click'
    | 'right_click'
    | 'move'
    | 'scroll'
    | 'drag'
    | 'type'
    | 'key'
    | 'wait'
    | 'launch'
    | 'exec'
    | 'remember'
    | 'thought';
  summary: string;
  detail?: string;
}

export type WsEvent =
  | { type: 'hello'; agents: Agent[] }
  | { type: 'agent_created'; agent: Agent }
  | { type: 'agent_updated'; agent: Agent }
  | { type: 'agent_deleted'; agentId: string }
  | { type: 'message'; message: Message };
