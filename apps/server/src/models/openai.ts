/**
 * OpenAI adapter — Responses API with the `computer_use_preview` tool.
 * State is chained server-side via previous_response_id.
 */
import type { ComputerAction } from "@grokbot/shared";
import type { AdapterInit, AgentDecision, ModelAdapter, ToolOutcome } from "./types.js";
import { customTools, parseCustomToolCall } from "./toolset.js";
import { requestSignal } from "./abort.js";

type Item = Record<string, unknown>;

function mapComputerAction(action: Record<string, unknown>): ComputerAction | { error: string } {
  const t = String(action.type ?? "");
  const x = Number(action.x ?? 0);
  const y = Number(action.y ?? 0);
  switch (t) {
    case "screenshot":
      return { type: "screenshot" };
    case "click": {
      const button = String(action.button ?? "left");
      if (button === "right") return { type: "right_click", x, y };
      if (button === "wheel" || button === "middle") return { type: "middle_click", x, y };
      return { type: "left_click", x, y };
    }
    case "double_click":
      return { type: "double_click", x, y };
    case "move":
      return { type: "mouse_move", x, y };
    case "drag": {
      const path = (action.path as { x: number; y: number }[] | undefined) ?? [];
      if (path.length < 2) return { error: "drag path needs at least 2 points" };
      const s = path[0]!;
      const e = path[path.length - 1]!;
      return { type: "left_click_drag", startX: s.x, startY: s.y, x: e.x, y: e.y };
    }
    case "scroll": {
      const sx = Number(action.scroll_x ?? 0);
      const sy = Number(action.scroll_y ?? 0);
      // convert pixel deltas to wheel clicks (~60px per click)
      if (Math.abs(sy) >= Math.abs(sx)) {
        return { type: "scroll", x, y, direction: sy >= 0 ? "down" : "up", amount: Math.max(1, Math.round(Math.abs(sy) / 60)) };
      }
      return { type: "scroll", x, y, direction: sx >= 0 ? "right" : "left", amount: Math.max(1, Math.round(Math.abs(sx) / 60)) };
    }
    case "type":
      return { type: "type", text: String(action.text ?? "") };
    case "keypress": {
      const keys = (action.keys as string[] | undefined) ?? [];
      return { type: "key", key: keys.join("+") || "Return" };
    }
    case "wait":
      return { type: "wait", durationMs: 1500 };
    default:
      return { error: `unsupported computer action "${t}"` };
  }
}

export class OpenAIAdapter implements ModelAdapter {
  private fetchFn: typeof fetch;
  private previousResponseId: string | null = null;
  /** call_id -> pending safety checks that must be acknowledged when we answer */
  private pendingSafety = new Map<string, unknown[]>();
  /** call ids that came from computer_call (vs function_call) */
  private computerCallIds = new Set<string>();
  private unsupported = new Map<string, string>();
  private baseUrl: string;

  constructor(private init: AdapterInit) {
    this.fetchFn = init.fetchFn ?? fetch;
    this.baseUrl = (init.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  private tools(): Item[] {
    const custom = customTools(this.init.collaborationEnabled).map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: t.parameters,
        required: t.required,
        additionalProperties: false,
      },
    }));
    return [
      {
        type: "computer_use_preview",
        display_width: this.init.resolution.width,
        display_height: this.init.resolution.height,
        environment: "linux",
      },
      ...custom,
    ];
  }

  private async call(input: Item[], signal?: AbortSignal): Promise<AgentDecision> {
    const body: Record<string, unknown> = {
      model: this.init.model,
      input,
      tools: this.tools(),
      instructions: this.init.systemPrompt,
      truncation: "auto",
    };
    if (this.previousResponseId) body.previous_response_id = this.previousResponseId;

    const res = await this.fetchFn(`${this.baseUrl}/responses`, {
      method: "POST",
      signal: requestSignal(180_000, signal),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.init.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { id: string; output: Item[] };
    this.previousResponseId = data.id;

    const texts: string[] = [];
    const invocations: (AgentDecision & { kind: "act" })["invocations"] = [];
    for (const item of data.output ?? []) {
      const type = String(item.type ?? "");
      if (type === "message") {
        const content = (item.content as Item[] | undefined) ?? [];
        for (const c of content) {
          if (c.type === "output_text") texts.push(String(c.text ?? ""));
        }
      } else if (type === "computer_call") {
        const callId = String(item.call_id);
        this.computerCallIds.add(callId);
        const checks = (item.pending_safety_checks as unknown[] | undefined) ?? [];
        if (checks.length > 0) this.pendingSafety.set(callId, checks);
        const mapped = mapComputerAction((item.action ?? {}) as Record<string, unknown>);
        if ("error" in mapped) {
          this.unsupported.set(callId, mapped.error);
          invocations.push({ id: callId, tool: "computer", action: { type: "screenshot" } });
        } else {
          const inv: (typeof invocations)[number] = { id: callId, tool: "computer", action: mapped };
          if (checks.length > 0) {
            inv.needsConfirmation = checks
              .map((c) => String((c as Record<string, unknown>).message ?? "safety check"))
              .join("; ");
          }
          invocations.push(inv);
        }
      } else if (type === "function_call") {
        const callId = String(item.call_id);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(item.arguments ?? "{}"));
        } catch {
          /* leave empty */
        }
        const inv = parseCustomToolCall(callId, String(item.name), args);
        if (inv) invocations.push(inv);
      }
    }
    if (invocations.length === 0) {
      return { kind: "final", text: texts.join("\n").trim() || "(no reply)" };
    }
    return { kind: "act", invocations, assistantText: texts.join("\n").trim() || undefined };
  }

  async start(taskPrompt: string, screenshotB64: string, signal?: AbortSignal): Promise<AgentDecision> {
    return this.call(
      [
        {
          role: "user",
          content: [
            { type: "input_text", text: taskPrompt },
            { type: "input_image", image_url: `data:image/png;base64,${screenshotB64}` },
          ],
        },
      ],
      signal,
    );
  }

  async next(outcomes: ToolOutcome[], signal?: AbortSignal): Promise<AgentDecision> {
    const input: Item[] = outcomes.map((o) => {
      if (this.computerCallIds.has(o.id)) {
        this.computerCallIds.delete(o.id);
        const item: Item = {
          type: "computer_call_output",
          call_id: o.id,
          output: {
            type: "computer_screenshot",
            image_url: `data:image/png;base64,${o.screenshotB64 ?? ""}`,
          },
        };
        const checks = this.pendingSafety.get(o.id);
        if (checks) {
          item.acknowledged_safety_checks = checks;
          this.pendingSafety.delete(o.id);
        }
        const err = this.unsupported.get(o.id);
        if (err) this.unsupported.delete(o.id);
        return item;
      }
      return { type: "function_call_output", call_id: o.id, output: o.output || "ok" };
    });
    return this.call(input, signal);
  }
}
