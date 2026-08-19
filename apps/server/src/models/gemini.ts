/**
 * Google Gemini adapter — Interactions API with the `computer_use` tool
 * (desktop environment). Coordinates are normalized 0-999 and scaled to pixels.
 * Handles both Gemini 3.x streamlined commands and 2.5 legacy commands.
 */
import type { ComputerAction } from "@grokbot/shared";
import type { AdapterInit, AgentDecision, ModelAdapter, ToolOutcome } from "./types.js";
import { customTools, parseCustomToolCall } from "./toolset.js";
import type { ToolInvocation } from "./types.js";
import { requestSignal } from "./abort.js";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

type Item = Record<string, unknown>;

export class GeminiAdapter implements ModelAdapter {
  private fetchFn: typeof fetch;
  private previousInteractionId: string | null = null;
  /** call_id -> function name (needed in function_result) */
  private callNames = new Map<string, string>();
  private overrides = new Map<string, string>();
  private customToolsSupported = true;
  private callCounter = 0;

  constructor(private init: AdapterInit) {
    this.fetchFn = init.fetchFn ?? fetch;
  }

  private px(x: number, axis: "x" | "y"): number {
    const size = axis === "x" ? this.init.resolution.width : this.init.resolution.height;
    return Math.max(0, Math.min(size - 1, Math.round((x / 1000) * size)));
  }

  /** Map a Gemini computer-use function call to a neutral invocation. */
  private mapCall(id: string, name: string, args: Record<string, unknown>): ToolInvocation | { error: string } {
    const X = args.x !== undefined ? this.px(Number(args.x), "x") : 0;
    const Y = args.y !== undefined ? this.px(Number(args.y), "y") : 0;
    const mkBatch = (steps: ComputerAction[], description: string): ToolInvocation => ({
      id,
      tool: "computer",
      action: { type: "batch", steps, description },
    });

    switch (name) {
      // ── Gemini 3.x streamlined + shared ──
      case "take_screenshot":
        return { id, tool: "computer", action: { type: "screenshot" } };
      case "click":
      case "click_at":
        return { id, tool: "computer", action: { type: "left_click", x: X, y: Y } };
      case "double_click":
        return { id, tool: "computer", action: { type: "double_click", x: X, y: Y } };
      case "triple_click":
        return { id, tool: "computer", action: { type: "triple_click", x: X, y: Y } };
      case "middle_click":
        return { id, tool: "computer", action: { type: "middle_click", x: X, y: Y } };
      case "right_click":
        return { id, tool: "computer", action: { type: "right_click", x: X, y: Y } };
      case "move":
      case "hover_at":
        return { id, tool: "computer", action: { type: "mouse_move", x: X, y: Y } };
      case "type": {
        const steps: ComputerAction[] = [{ type: "type", text: String(args.text ?? "") }];
        if (args.press_enter === true) steps.push({ type: "key", key: "Return" });
        return steps.length === 1
          ? { id, tool: "computer", action: steps[0]! }
          : mkBatch(steps, `Typed "${String(args.text ?? "").slice(0, 40)}"`);
      }
      case "type_text_at": {
        const steps: ComputerAction[] = [{ type: "left_click", x: X, y: Y }];
        if (args.clear_before_typing !== false) {
          steps.push({ type: "key", key: "ctrl+a" }, { type: "key", key: "Delete" });
        }
        steps.push({ type: "type", text: String(args.text ?? "") });
        if (args.press_enter !== false) steps.push({ type: "key", key: "Return" });
        return mkBatch(steps, `Typed "${String(args.text ?? "").slice(0, 40)}" at (${X}, ${Y})`);
      }
      case "drag_and_drop":
        return {
          id,
          tool: "computer",
          action: {
            type: "left_click_drag",
            startX: this.px(Number(args.start_x ?? 0), "x"),
            startY: this.px(Number(args.start_y ?? 0), "y"),
            x: this.px(Number(args.end_x ?? 0), "x"),
            y: this.px(Number(args.end_y ?? 0), "y"),
          },
        };
      case "scroll":
      case "scroll_at": {
        const direction = String(args.direction ?? "down") as "up" | "down" | "left" | "right";
        const magnitude = Number(args.magnitude_in_pixels ?? args.magnitude ?? 300);
        return {
          id,
          tool: "computer",
          action: { type: "scroll", x: X || Math.round(this.init.resolution.width / 2), y: Y || Math.round(this.init.resolution.height / 2), direction, amount: Math.max(1, Math.round(magnitude / 100)) },
        };
      }
      case "scroll_document": {
        const direction = String(args.direction ?? "down") as "up" | "down" | "left" | "right";
        return {
          id,
          tool: "computer",
          action: {
            type: "scroll",
            x: Math.round(this.init.resolution.width / 2),
            y: Math.round(this.init.resolution.height / 2),
            direction,
            amount: 8,
          },
        };
      }
      case "press_key":
        return { id, tool: "computer", action: { type: "key", key: String(args.key ?? "Return") } };
      case "hotkey": {
        const keys = (args.keys as string[] | undefined) ?? [];
        return { id, tool: "computer", action: { type: "key", key: keys.join("+") || "Return" } };
      }
      case "key_combination":
        return { id, tool: "computer", action: { type: "key", key: String(args.keys ?? "Return").replace(/\s*\+\s*/g, "+") } };
      case "key_down":
        return { id, tool: "computer", action: { type: "hold_key", key: String(args.key ?? ""), durationMs: 100 } };
      case "key_up":
        return { id, tool: "computer", action: { type: "key", key: String(args.key ?? "") } };
      case "wait": {
        const seconds = Number(args.seconds ?? 1);
        return { id, tool: "computer", action: { type: "wait", durationMs: Math.min(seconds, 30) * 1000 } };
      }
      case "wait_5_seconds":
        return { id, tool: "computer", action: { type: "wait", durationMs: 5000 } };

      // ── browser conveniences mapped onto the desktop ──
      case "open_web_browser":
        return { id, tool: "bash", command: "DISPLAY=:0 nohup /usr/local/bin/browser >/dev/null 2>&1 & sleep 3" };
      case "navigate": {
        const url = String(args.url ?? "").replace(/'/g, "%27");
        return { id, tool: "bash", command: `DISPLAY=:0 nohup /usr/local/bin/browser '${url}' >/dev/null 2>&1 & sleep 3` };
      }
      case "search":
        return { id, tool: "bash", command: "DISPLAY=:0 nohup /usr/local/bin/browser 'https://duckduckgo.com' >/dev/null 2>&1 & sleep 3" };
      case "go_back":
        return { id, tool: "computer", action: { type: "key", key: "alt+Left" } };
      case "go_forward":
        return { id, tool: "computer", action: { type: "key", key: "alt+Right" } };

      case "mouse_down":
      case "mouse_up":
      case "long_press":
      default:
        return { error: `unsupported computer action "${name}"` };
    }
  }

  private tools(): Item[] {
    const base: Item[] = [{ type: "computer_use", environment: "desktop" }];
    if (!this.customToolsSupported) return base;
    const custom = customTools(this.init.collaborationEnabled).map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties: t.parameters, required: t.required },
    }));
    return [...base, ...custom];
  }

  private async call(input: Item[] | string, retried = false, signal?: AbortSignal): Promise<AgentDecision> {
    const body: Record<string, unknown> = {
      model: this.init.model,
      input,
      tools: this.tools(),
    };
    if (this.previousInteractionId) body.previous_interaction_id = this.previousInteractionId;

    const res = await this.fetchFn(API_URL, {
      method: "POST",
      signal: requestSignal(180_000, signal),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.init.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      // some deployments may reject mixing custom functions with computer_use — retry without them
      if (res.status === 400 && this.customToolsSupported && !retried && /tool|function/i.test(text)) {
        this.customToolsSupported = false;
        return this.call(input, true, signal);
      }
      throw new Error(`Gemini API ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { id: string; steps?: Item[] };
    this.previousInteractionId = data.id;

    const texts: string[] = [];
    const invocations: (AgentDecision & { kind: "act" })["invocations"] = [];
    for (const step of data.steps ?? []) {
      const type = String(step.type ?? "");
      if (type === "model_output") {
        for (const c of (step.content as Item[] | undefined) ?? []) {
          if (c.type === "text") texts.push(String(c.text ?? ""));
        }
      } else if (type === "function_call") {
        const name = String(step.name ?? "");
        const id = String(step.id ?? `call_${++this.callCounter}`);
        this.callNames.set(id, name);
        const rawArgs = (step.arguments ?? {}) as Record<string, unknown>;

        // provider-side safety decision
        const safety = (step.safety_decision ?? rawArgs.safety_decision) as
          | { decision?: string; explanation?: string }
          | undefined;

        const custom = parseCustomToolCall(id, name, rawArgs);
        let inv: (typeof invocations)[number];
        if (custom) {
          inv = custom;
        } else {
          const mapped = this.mapCall(id, name, rawArgs);
          if ("error" in mapped) {
            this.overrides.set(id, mapped.error);
            inv = { id, tool: "computer", action: { type: "screenshot" } };
          } else {
            inv = mapped;
          }
        }

        if (safety?.decision === "require_confirmation") {
          inv.needsConfirmation = safety.explanation ?? "The model's safety system asks for your confirmation.";
        } else if (safety?.decision === "blocked") {
          this.overrides.set(id, `Action blocked by the safety system: ${safety.explanation ?? ""}`);
          inv = { id, tool: "computer", action: { type: "screenshot" } };
        }
        invocations.push(inv);
      }
    }
    if (invocations.length === 0) {
      return { kind: "final", text: texts.join("\n").trim() || "(no reply)" };
    }
    return { kind: "act", invocations, assistantText: texts.join("\n").trim() || undefined };
  }

  async start(taskPrompt: string, screenshotB64: string, signal?: AbortSignal): Promise<AgentDecision> {
    // The Interactions API takes no separate system field — prepend it.
    const text = `SYSTEM INSTRUCTIONS:\n${this.init.systemPrompt}\n\n---\nTASK:\n${taskPrompt}`;
    return this.call(
      [
        { type: "text", text },
        { type: "image", data: screenshotB64, mime_type: "image/png" },
      ],
      false,
      signal,
    );
  }

  async next(outcomes: ToolOutcome[], signal?: AbortSignal): Promise<AgentDecision> {
    const input: Item[] = outcomes.map((o) => {
      const name = this.callNames.get(o.id) ?? o.tool;
      this.callNames.delete(o.id);
      const override = this.overrides.get(o.id);
      if (override) this.overrides.delete(o.id);
      const result: Item[] = [{ type: "text", text: override ?? (o.output || "ok") }];
      if (o.screenshotB64) {
        result.push({ type: "image", data: o.screenshotB64, mime_type: "image/png" });
      }
      return { type: "function_result", name, call_id: o.id, result };
    });
    return this.call(input, false, signal);
  }
}
