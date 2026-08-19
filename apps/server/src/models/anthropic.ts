/**
 * Anthropic (Claude) adapter — Messages API with the native `computer` tool.
 * https://docs.anthropic.com — computer use via the "computer-use-2025-01-24" beta.
 */
import type { ComputerAction } from "@grokbot/shared";
import type { AdapterInit, AgentDecision, ModelAdapter, ToolOutcome } from "./types.js";
import { customTools, parseCustomToolCall } from "./toolset.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const BETA = "computer-use-2025-01-24";

type Block = Record<string, unknown>;

function mapComputerAction(input: Record<string, unknown>): ComputerAction | { error: string } {
  const action = String(input.action ?? "");
  const coord = (input.coordinate as [number, number] | undefined) ?? undefined;
  const start = (input.start_coordinate as [number, number] | undefined) ?? undefined;
  switch (action) {
    case "screenshot":
      return { type: "screenshot" };
    case "left_click":
      return coord ? { type: "left_click", x: coord[0], y: coord[1] } : { error: "coordinate required" };
    case "double_click":
      return coord ? { type: "double_click", x: coord[0], y: coord[1] } : { error: "coordinate required" };
    case "triple_click":
      return coord ? { type: "triple_click", x: coord[0], y: coord[1] } : { error: "coordinate required" };
    case "right_click":
      return coord ? { type: "right_click", x: coord[0], y: coord[1] } : { error: "coordinate required" };
    case "middle_click":
      return coord ? { type: "middle_click", x: coord[0], y: coord[1] } : { error: "coordinate required" };
    case "mouse_move":
      return coord ? { type: "mouse_move", x: coord[0], y: coord[1] } : { error: "coordinate required" };
    case "left_click_drag":
      return start && coord
        ? { type: "left_click_drag", startX: start[0], startY: start[1], x: coord[0], y: coord[1] }
        : { error: "start_coordinate and coordinate required" };
    case "scroll": {
      const dir = String(input.scroll_direction ?? "down") as "up" | "down" | "left" | "right";
      const amount = Number(input.scroll_amount ?? 3);
      return { type: "scroll", x: coord?.[0] ?? 0, y: coord?.[1] ?? 0, direction: dir, amount };
    }
    case "type":
      return { type: "type", text: String(input.text ?? "") };
    case "key":
      return { type: "key", key: String(input.text ?? "") };
    case "hold_key":
      return { type: "hold_key", key: String(input.text ?? ""), durationMs: Number(input.duration ?? 1) * 1000 };
    case "wait":
      return { type: "wait", durationMs: Number(input.duration ?? 1) * 1000 };
    case "cursor_position":
      return { type: "cursor_position" };
    default:
      return { error: `unsupported computer action "${action}"` };
  }
}

export class AnthropicAdapter implements ModelAdapter {
  private messages: { role: "user" | "assistant"; content: Block[] }[] = [];
  /** tool_use_id -> tool name, to route results */
  private fetchFn: typeof fetch;

  constructor(private init: AdapterInit) {
    this.fetchFn = init.fetchFn ?? fetch;
  }

  private tools(): Block[] {
    const custom = customTools(new Set(this.init.allowedTools)).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: "object", properties: t.parameters, required: t.required },
    }));
    return [
      {
        type: "computer_20250124",
        name: "computer",
        display_width_px: this.init.resolution.width,
        display_height_px: this.init.resolution.height,
      },
      ...custom,
    ];
  }

  private async call(): Promise<AgentDecision> {
    const res = await this.fetchFn(API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.init.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": BETA,
      },
      body: JSON.stringify({
        model: this.init.model,
        max_tokens: 4096,
        system: this.init.systemPrompt,
        messages: this.messages,
        tools: this.tools(),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as { content: Block[]; stop_reason: string };
    this.messages.push({ role: "assistant", content: data.content });

    const texts: string[] = [];
    const invocations: (AgentDecision & { kind: "act" })["invocations"] = [];
    for (const block of data.content) {
      if (block.type === "text") texts.push(String(block.text ?? ""));
      if (block.type === "tool_use") {
        const id = String(block.id);
        const name = String(block.name);
        const input = (block.input ?? {}) as Record<string, unknown>;
        if (name === "computer") {
          const mapped = mapComputerAction(input);
          if ("error" in mapped) {
            // report the mapping problem back to the model as an errored invocation
            invocations.push({ id, tool: "computer", action: { type: "screenshot" } });
            this.unsupported.set(id, mapped.error);
          } else {
            invocations.push({ id, tool: "computer", action: mapped });
          }
        } else {
          const inv = parseCustomToolCall(id, name, input);
          if (inv) invocations.push(inv);
        }
      }
    }
    if (invocations.length === 0) {
      return { kind: "final", text: texts.join("\n").trim() || "(no reply)" };
    }
    return { kind: "act", invocations, assistantText: texts.join("\n").trim() || undefined };
  }

  /** ids whose computer action couldn't be mapped; replaced with error results */
  private unsupported = new Map<string, string>();

  async start(taskPrompt: string, screenshotB64: string): Promise<AgentDecision> {
    this.messages.push({
      role: "user",
      content: [
        { type: "text", text: taskPrompt },
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotB64 } },
      ],
    });
    return this.call();
  }

  async next(outcomes: ToolOutcome[]): Promise<AgentDecision> {
    const results: Block[] = outcomes.map((o) => {
      const override = this.unsupported.get(o.id);
      if (override) {
        this.unsupported.delete(o.id);
        return { type: "tool_result", tool_use_id: o.id, is_error: true, content: [{ type: "text", text: override }] };
      }
      const content: Block[] = [{ type: "text", text: o.output || "ok" }];
      if (o.screenshotB64) {
        content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: o.screenshotB64 } });
      }
      return { type: "tool_result", tool_use_id: o.id, is_error: o.isError ?? false, content };
    });
    this.messages.push({ role: "user", content: results });
    this.trimHistory();
    return this.call();
  }

  /** Keep prompt size bounded: drop images from all but the 3 most recent user messages. */
  private trimHistory(): void {
    let imagesSeen = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i]!;
      if (msg.role !== "user") continue;
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const block = msg.content[j]!;
        const isDirectImage = block.type === "image";
        const isResultImage =
          block.type === "tool_result" &&
          Array.isArray(block.content) &&
          (block.content as Block[]).some((c) => c.type === "image");
        if (isDirectImage || isResultImage) {
          imagesSeen += 1;
          if (imagesSeen > 3) {
            if (isDirectImage) {
              msg.content[j] = { type: "text", text: "(earlier screenshot removed)" };
            } else {
              block.content = (block.content as Block[]).map((c) =>
                c.type === "image" ? { type: "text", text: "(earlier screenshot removed)" } : c,
              );
            }
          }
        }
      }
    }
  }
}
