import type { ProviderId, Settings } from "../types";
import { MODEL_CATALOG } from "../types";

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResult {
  text: string;
  toolCalls: ToolCall[];
  usedModel: string;
}

export const AGENT_TOOLS: ChatTool[] = [
  {
    name: "open_app",
    description: "Open Files, Browser, or Terminal on this Bot's OS.",
    parameters: {
      type: "object",
      properties: { app: { type: "string", enum: ["files", "browser", "terminal"] } },
      required: ["app"],
    },
  },
  {
    name: "mouse_move",
    description: "Move the desktop cursor. Desktop is 1280x720.",
    parameters: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  {
    name: "click",
    description: "Click at the current cursor position.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "type_text",
    description: "Type into the focused window.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "browse",
    description: "Open a URL in this Bot's browser.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from this Bot's home.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "write_file",
    description: "Write a file in this Bot's home.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, content: { type: "string" } },
      required: ["name", "content"],
    },
  },
  {
    name: "run_shell",
    description: "Run a short shell command in this Bot's home.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "message_bot",
    description: "Message another Bot. Only when the user asked you to collaborate.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        message: { type: "string" },
      },
      required: ["name", "message"],
    },
  },
  {
    name: "request_approval",
    description: "Pause for the user before a consequential action.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string" },
        summary: { type: "string" },
      },
      required: ["action", "summary"],
    },
  },
  {
    name: "remember",
    description: "Save a durable preference or fact for this Bot only.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
];

function openaiTools() {
  return AGENT_TOOLS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { raw };
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

export async function completeModel(input: {
  provider: ProviderId;
  model: string;
  settings: Settings;
  messages: ChatTurn[];
}): Promise<ModelResult> {
  if (input.provider === "rehearsal") {
    return { text: "", toolCalls: [], usedModel: "rehearsal" };
  }

  const config = input.settings.providers[input.provider];
  const catalog = MODEL_CATALOG[input.provider];
  const baseUrl = config?.baseUrl || catalog.defaultBaseUrl || "";
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error(`No API key for ${input.provider}. Add one in Settings.`);
  }

  if (input.provider === "anthropic") {
    return completeAnthropic({ ...input, apiKey, baseUrl });
  }
  if (input.provider === "google") {
    return completeGoogle({ ...input, apiKey, baseUrl });
  }
  return completeOpenAICompat({ ...input, apiKey, baseUrl });
}

async function completeOpenAICompat(input: {
  model: string;
  apiKey: string;
  baseUrl: string;
  messages: ChatTurn[];
}): Promise<ModelResult> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages.map((message) => ({
        role: message.role === "tool" ? "tool" : message.role,
        content: message.content,
        name: message.name,
      })),
      tools: openaiTools(),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Model HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const data = (await response.json()) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { function?: { name?: string; arguments?: string } }[];
      };
    }[];
    model?: string;
  };
  const message = data.choices?.[0]?.message;
  return {
    text: message?.content || "",
    usedModel: data.model || input.model,
    toolCalls: (message?.tool_calls || [])
      .map((call) => ({
        name: call.function?.name || "",
        arguments: parseArgs(call.function?.arguments),
      }))
      .filter((call) => call.name),
  };
}

async function completeAnthropic(input: {
  model: string;
  apiKey: string;
  baseUrl: string;
  messages: ChatTurn[];
}): Promise<ModelResult> {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 2048,
      system,
      tools: AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      messages: input.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Anthropic HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const data = (await response.json()) as {
    content?: { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[];
    model?: string;
  };
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n");
  const toolCalls = (data.content || [])
    .filter((block) => block.type === "tool_use" && block.name)
    .map((block) => ({ name: block.name as string, arguments: block.input || {} }));
  return { text, toolCalls, usedModel: data.model || input.model };
}

async function completeGoogle(input: {
  model: string;
  apiKey: string;
  baseUrl: string;
  messages: ChatTurn[];
}): Promise<ModelResult> {
  const url = `${input.baseUrl.replace(/\/$/, "")}/v1beta/models/${input.model}:generateContent?key=${input.apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: input.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      systemInstruction: {
        parts: [
          {
            text: input.messages
              .filter((message) => message.role === "system")
              .map((message) => message.content)
              .join("\n\n"),
          },
        ],
      },
      tools: [
        {
          functionDeclarations: AGENT_TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Google HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const data = (await response.json()) as {
    candidates?: {
      content?: {
        parts?: {
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
        }[];
      };
    }[];
  };
  const parts = data.candidates?.[0]?.content?.parts || [];
  return {
    text: parts.map((part) => part.text || "").join("\n"),
    usedModel: input.model,
    toolCalls: parts
      .filter((part) => part.functionCall?.name)
      .map((part) => ({
        name: part.functionCall!.name as string,
        arguments: part.functionCall?.args || {},
      })),
  };
}
