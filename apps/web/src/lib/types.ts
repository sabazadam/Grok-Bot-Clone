export const PROVIDERS = [
  "rehearsal",
  "openai",
  "anthropic",
  "google",
  "xai",
  "openrouter",
  "custom",
] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export type BotStatus = "idle" | "working" | "needs_attention";

export type ThreadKind = "dm" | "group";

export type MessageRole =
  | "user"
  | "bot"
  | "system"
  | "handoff"
  | "tool"
  | "approval"
  | "computer";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type WindowKind = "files" | "browser" | "terminal";

export interface MemoryNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface Bot {
  id: string;
  name: string;
  title: string;
  description: string;
  color: string;
  initials: string;
  provider: ProviderId;
  model: string;
  allowCollaboration: boolean;
  hidden: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  status: BotStatus;
  memory: MemoryNote[];
}

export interface Thread {
  id: string;
  kind: ThreadKind;
  title: string;
  botIds: string[];
  allowCollaboration: boolean;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: MessageRole;
  botId?: string;
  content: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface Skill {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  threadId: string;
  botId: string;
  action: string;
  summary: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface AuditEvent {
  id: string;
  botId: string;
  threadId?: string;
  kind: string;
  detail: string;
  createdAt: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface Settings {
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  timezone: string;
}

export interface DesktopWindow {
  id: string;
  kind: WindowKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  focused: boolean;
  minimized: boolean;
}

export interface FsEntry {
  name: string;
  kind: "file" | "dir";
  size?: number;
}

export interface WorkstationState {
  botId: string;
  width: number;
  height: number;
  cursor: { x: number; y: number };
  wallpaper: string;
  windows: DesktopWindow[];
  files: FsEntry[];
  browser: {
    url: string;
    title: string;
    body: string;
    loading: boolean;
  };
  terminal: {
    cwd: string;
    lines: string[];
    input: string;
  };
  lastAction: string;
  takeover: boolean;
  updatedAt: string;
}

export interface AppState {
  bots: Bot[];
  threads: Thread[];
  messages: ChatMessage[];
  skills: Skill[];
  approvals: Approval[];
  audit: AuditEvent[];
  settings: Settings;
  workstations: Record<string, WorkstationState>;
}

export const MODEL_CATALOG: Record<
  Exclude<ProviderId, "rehearsal">,
  { label: string; models: string[]; defaultBaseUrl?: string }
> = {
  openai: {
    label: "OpenAI",
    models: ["gpt-5.4", "gpt-4.1", "gpt-4o"],
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Anthropic",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    defaultBaseUrl: "https://api.anthropic.com",
  },
  google: {
    label: "Google",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
  },
  xai: {
    label: "xAI",
    models: ["grok-4", "grok-3"],
    defaultBaseUrl: "https://api.x.ai/v1",
  },
  openrouter: {
    label: "OpenRouter",
    models: [
      "openai/gpt-4.1",
      "anthropic/claude-sonnet-4.6",
      "x-ai/grok-4",
      "google/gemini-2.5-pro",
    ],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    models: ["local-model"],
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
  },
};

export const BOT_COLORS = [
  "#f4b942",
  "#6ea8ff",
  "#7ee0a8",
  "#f0718d",
  "#c3a6ff",
  "#ff9f6b",
];
