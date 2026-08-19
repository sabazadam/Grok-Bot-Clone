/**
 * Generic adapter — any OpenAI-compatible /chat/completions endpoint with vision
 * (xAI Grok, Ollama, LM Studio, OpenRouter…). The model gets a strict JSON action
 * protocol; each turn receives the latest screenshot as an image.
 */
import type { ComputerAction } from "@grokbot/shared";
import type { AdapterInit, AgentDecision, ModelAdapter, ToolOutcome } from "./types.js";
import type { ToolInvocation } from "./types.js";

type Msg = { role: "system" | "user" | "assistant"; content: unknown };

const PROTOCOL = `
## How to act
You control the computer by replying with EXACTLY ONE JSON object per turn — no markdown fences, no extra prose outside the JSON. Schemas (pick one):

{"thought":"...","computer":{"type":"screenshot"}}
{"thought":"...","computer":{"type":"left_click","x":100,"y":200}}          // also: double_click, triple_click, right_click, middle_click, mouse_move
{"thought":"...","computer":{"type":"left_click_drag","startX":1,"startY":1,"x":2,"y":2}}
{"thought":"...","computer":{"type":"scroll","x":640,"y":400,"direction":"down","amount":3}}
{"thought":"...","computer":{"type":"type","text":"hello"}}
{"thought":"...","computer":{"type":"key","key":"ctrl+l"}}                  // xdotool key names, e.g. Return, Escape, alt+Tab
{"thought":"...","computer":{"type":"wait","durationMs":2000}}
{"thought":"...","bash":{"command":"ls ~/workspace","timeoutSec":60}}
{"thought":"...","update_memory":{"kind":"fact","content":"..."}}           // kind: preference|fact|summary
{"thought":"...","request_approval":{"description":"...","reason":"..."}}
{"thought":"...","save_skill":{"name":"...","description":"...","instructions":"..."}}
{"thought":"...","create_agent":{"name":"...","roleTitle":"...","instructions":"...","isTeamLead":false}}
{"thought":"...","create_routine":{"name":"...","prompt":"...","schedule":"every morning","skillName":"optional"}}
{"thought":"...","send_message":{"text":"..."}}                         // only when the user needs to know something now
{"thought":"...","send_message_to_agent":{"toAgentName":"Name","text":"..."}}
{"done":true,"message":"your final reply to the requester"}             // use {"done":true,"message":"ACK"} if no reply is needed

Thoughts stay internal — they are not posted to chat. Stay silent while you work on the computer. Message only when necessary and related to the task.

Coordinates are pixels on the screenshot you see. After every action you receive the result and a fresh screenshot. Think step by step in "thought". When the task is complete (or impossible), reply with the {"done":true,...} form.`;

const TEXT_ONLY = `
## Vision
This endpoint cannot receive screenshots (text-only). Do not wait for pixels and do not emit screenshot computer actions.
Inspect the computer with bash and write notes to ~/workspace:
- Files: ls, cat, python3
- Web research: FIRST open the GUI browser so the user can watch:
  DISPLAY=:0 nohup /usr/local/bin/browser 'https://www.google.com/search?q=…' >/dev/null 2>&1 &
  Then fetch the same page with: curl -sL -A "Mozilla/5.0" <url> (parse with python3).
- Prefer bash over blind mouse clicks. Do not spend turns on screenshot/click when bash can finish the job.
- After you have the facts, {"done":true,"message":"…"} immediately. Do not loop on the same python parse.`;

function looksLikeDeepSeek(init: AdapterInit): boolean {
  return `${init.baseUrl ?? ""} ${init.model}`.toLowerCase().includes("deepseek");
}

function isImageRejected(status: number, body: string): boolean {
  return status === 400 && /image_url|unknown variant|does not support|vision|image/i.test(body);
}

function extractJson(text: string): Record<string, unknown> | undefined {
  // strip common fencing, then find the first balanced {...}
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

const VALID_ACTIONS = new Set([
  "screenshot",
  "left_click",
  "double_click",
  "triple_click",
  "right_click",
  "middle_click",
  "mouse_move",
  "left_click_drag",
  "scroll",
  "type",
  "key",
  "hold_key",
  "wait",
  "cursor_position",
]);

function parseProtocolAction(obj: Record<string, unknown>, id: string): ToolInvocation | undefined {
  if (obj.computer && typeof obj.computer === "object") {
    const action = obj.computer as ComputerAction;
    if (VALID_ACTIONS.has(action.type)) return { id, tool: "computer", action };
  }
  if (obj.bash && typeof obj.bash === "object") {
    return { id, tool: "bash", command: String((obj.bash as Record<string, unknown>).command ?? "") };
  }
  if (typeof obj.bash === "string") {
    return { id, tool: "bash", command: obj.bash };
  }
  if (obj.update_memory && typeof obj.update_memory === "object") {
    const m = obj.update_memory as Record<string, unknown>;
    const kind = ["preference", "fact", "summary"].includes(String(m.kind))
      ? (String(m.kind) as "preference" | "fact" | "summary")
      : "fact";
    return { id, tool: "update_memory", memoryKind: kind, content: String(m.content ?? "") };
  }
  if (obj.request_approval && typeof obj.request_approval === "object") {
    const r = obj.request_approval as Record<string, unknown>;
    return { id, tool: "request_approval", description: String(r.description ?? ""), reason: String(r.reason ?? "") };
  }
  if (obj.save_skill && typeof obj.save_skill === "object") {
    const s = obj.save_skill as Record<string, unknown>;
    return {
      id,
      tool: "save_skill",
      name: String(s.name ?? ""),
      description: String(s.description ?? ""),
      instructions: String(s.instructions ?? ""),
    };
  }
  if (obj.create_agent && typeof obj.create_agent === "object") {
    const a = obj.create_agent as Record<string, unknown>;
    return {
      id,
      tool: "create_agent",
      name: String(a.name ?? ""),
      roleTitle: String(a.roleTitle ?? ""),
      instructions: String(a.instructions ?? ""),
      isTeamLead: Boolean(a.isTeamLead),
    };
  }
  if (obj.create_routine && typeof obj.create_routine === "object") {
    const r = obj.create_routine as Record<string, unknown>;
    return {
      id,
      tool: "create_routine",
      name: String(r.name ?? ""),
      prompt: String(r.prompt ?? ""),
      intervalMinutes: r.intervalMinutes !== undefined ? Number(r.intervalMinutes) : undefined,
      schedule: r.schedule ? String(r.schedule) : undefined,
      skillName: r.skillName ? String(r.skillName) : undefined,
    };
  }
  if (obj.send_message && typeof obj.send_message === "object") {
    return { id, tool: "send_message", text: String((obj.send_message as Record<string, unknown>).text ?? "") };
  }
  if (typeof obj.send_message === "string") {
    return { id, tool: "send_message", text: obj.send_message };
  }
  if (obj.send_message_to_agent && typeof obj.send_message_to_agent === "object") {
    const s = obj.send_message_to_agent as Record<string, unknown>;
    return { id, tool: "send_message_to_agent", toAgentName: String(s.toAgentName ?? ""), text: String(s.text ?? "") };
  }
  return undefined;
}

export class GenericAdapter implements ModelAdapter {
  private fetchFn: typeof fetch;
  private messages: Msg[] = [];
  private baseUrl: string;
  private counter = 0;
  private parseFailures = 0;
  /** Official DeepSeek chat is text-only; also flipped on if a vision payload is rejected. */
  private textOnly: boolean;
  private disableThinking: boolean;

  constructor(private init: AdapterInit) {
    this.fetchFn = init.fetchFn ?? fetch;
    this.baseUrl = (init.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "");
    const deepseek = looksLikeDeepSeek(init);
    this.textOnly = deepseek;
    this.disableThinking = deepseek;
    this.messages.push({
      role: "system",
      content: init.systemPrompt + "\n" + PROTOCOL + (this.textOnly ? "\n" + TEXT_ONLY : ""),
    });
  }

  private userContent(text: string, screenshotB64?: string): unknown {
    if (this.textOnly || !screenshotB64) {
      return screenshotB64 && this.textOnly
        ? `${text}\n(screenshot captured but not attached — text-only model; inspect with bash)`
        : text;
    }
    return [
      { type: "text", text },
      { type: "image_url", image_url: { url: `data:image/png;base64,${screenshotB64}` } },
    ];
  }

  private stripImagesFromHistory(): void {
    for (const msg of this.messages) {
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      const texts: string[] = [];
      for (const part of msg.content as { type?: string; text?: string }[]) {
        if (part.type === "text" && part.text) texts.push(part.text);
        if (part.type === "image_url") texts.push("(screenshot omitted — text-only model)");
      }
      msg.content = texts.join("\n") || "(earlier screenshot omitted)";
    }
  }

  private async call(): Promise<AgentDecision> {
    const payload: Record<string, unknown> = {
      model: this.init.model,
      messages: this.messages,
      max_tokens: this.disableThinking ? 4096 : 2048,
      temperature: 0.2,
    };
    if (this.disableThinking) payload.thinking = { type: "disabled" };

    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.init.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      if (!this.textOnly && isImageRejected(res.status, text)) {
        this.textOnly = true;
        this.stripImagesFromHistory();
        if (typeof this.messages[0]?.content === "string" && !this.messages[0].content.includes("cannot receive screenshots")) {
          this.messages[0].content += "\n" + TEXT_ONLY;
        }
        this.messages.push({
          role: "user",
          content: "This endpoint rejected images. Continue in text-only mode: inspect the computer with bash.",
        });
        return this.call();
      }
      throw new Error(`Model API ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices: { message: { content?: string; reasoning_content?: string } }[];
    };
    const msg = data.choices?.[0]?.message ?? {};
    const content = (msg.content || msg.reasoning_content || "").trim();
    this.messages.push({ role: "assistant", content });

    const obj = extractJson(content);
    if (!obj) {
      this.parseFailures += 1;
      if (this.parseFailures >= 3) {
        return { kind: "final", text: content.trim() || "(the model did not produce a usable action)" };
      }
      this.messages.push({
        role: "user",
        content: 'Your reply was not a single valid JSON object. Reply with EXACTLY one JSON object per the protocol, e.g. {"done":true,"message":"..."}.',
      });
      return this.call();
    }
    this.parseFailures = 0;

    const id = `g_${++this.counter}`;
    const thought = typeof obj.thought === "string" ? obj.thought : undefined;
    const inv = parseProtocolAction(obj, id);

    // Explicit finish. Extra keys (models often echo the schema) must not run.
    if (obj.done === true) {
      return { kind: "final", text: String(obj.message ?? "Done.") };
    }
    // A stray top-level `message` string is a common LLM extra — do not treat it as
    // completion when a real action is present. That used to drop bash/clicks on
    // the default xAI/DeepSeek path.
    if (inv) {
      return { kind: "act", invocations: [inv], assistantText: thought };
    }
    if (typeof obj.message === "string") {
      return { kind: "final", text: obj.message };
    }

    this.messages.push({
      role: "user",
      content: `Unrecognized action ${JSON.stringify(Object.keys(obj))}. Use the documented protocol.`,
    });
    return this.call();
  }

  async start(taskPrompt: string, screenshotB64: string): Promise<AgentDecision> {
    this.messages.push({
      role: "user",
      content: this.userContent(`TASK:\n${taskPrompt}\n\nCurrent screen:`, screenshotB64),
    });
    return this.call();
  }

  async next(outcomes: ToolOutcome[]): Promise<AgentDecision> {
    for (const o of outcomes) {
      const text = `Result${o.isError ? " (ERROR)" : ""}: ${o.output || "ok"}${o.screenshotB64 ? "\nCurrent screen:" : ""}`;
      this.messages.push({ role: "user", content: this.userContent(text, o.screenshotB64) });
    }
    this.trimImages();
    return this.call();
  }

  /** Keep only the 3 most recent screenshots in history. */
  private trimImages(): void {
    let seen = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i]!;
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const part = msg.content[j] as { type?: string };
        if (part.type === "image_url") {
          seen += 1;
          if (seen > 3) {
            msg.content[j] = { type: "text", text: "(earlier screenshot removed)" };
          }
        }
      }
    }
  }
}
