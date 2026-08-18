export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string } // PNG
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: Part[]; isError?: boolean };

export interface Turn {
  role: 'user' | 'assistant';
  content: Part[];
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  turns: Turn[];
  tools: ToolDef[];
  maxTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface Provider {
  chat(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse>;
}
