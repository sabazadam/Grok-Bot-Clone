import { describe, it, expect, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { GeminiAdapter } from "./gemini.js";
import { GenericAdapter } from "./generic.js";
import type { AdapterInit } from "./types.js";

function mockFetch(responses: unknown[]): { fn: typeof fetch; calls: { url: string; body: any }[] } {
  const calls: { url: string; body: any }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    const payload = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function init(fetchFn: typeof fetch, extra: Partial<AdapterInit> = {}): AdapterInit {
  return {
    model: "test-model",
    systemPrompt: "You are a test agent.",
    resolution: { width: 1280, height: 800 },
    apiKey: "k",
    collaborationEnabled: true,
    fetchFn,
    ...extra,
  };
}

const SCREENSHOT = "aGVsbG8=";

describe("AnthropicAdapter", () => {
  it("maps computer tool_use to neutral actions and formats tool_result", async () => {
    const { fn, calls } = mockFetch([
      {
        content: [
          { type: "text", text: "Clicking now" },
          { type: "tool_use", id: "tu_1", name: "computer", input: { action: "left_click", coordinate: [100, 200] } },
        ],
        stop_reason: "tool_use",
      },
      { content: [{ type: "text", text: "All done" }], stop_reason: "end_turn" },
    ]);
    const a = new AnthropicAdapter(init(fn));
    const d1 = await a.start("do a thing", SCREENSHOT);
    expect(d1.kind).toBe("act");
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]).toMatchObject({ id: "tu_1", tool: "computer", action: { type: "left_click", x: 100, y: 200 } });
    expect(d1.assistantText).toBe("Clicking now");

    const d2 = await a.next([{ id: "tu_1", tool: "computer", output: "ok", screenshotB64: SCREENSHOT }]);
    expect(d2).toEqual({ kind: "final", text: "All done" });

    // request formats
    const first = calls[0]!.body;
    expect(first.system).toBe("You are a test agent.");
    expect(first.tools[0]).toMatchObject({ type: "computer_20250124", display_width_px: 1280, display_height_px: 800 });
    expect(first.tools.map((t: any) => t.name)).toContain("send_message_to_agent");
    const second = calls[1]!.body;
    const result = second.messages.at(-1);
    expect(result.role).toBe("user");
    expect(result.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    expect(result.content[0].content.some((c: any) => c.type === "image")).toBe(true);
  });

  it("maps scroll/key/hold_key/drag and custom tools", async () => {
    const { fn } = mockFetch([
      {
        content: [
          { type: "tool_use", id: "t1", name: "computer", input: { action: "scroll", coordinate: [10, 20], scroll_direction: "down", scroll_amount: 5 } },
          { type: "tool_use", id: "t2", name: "computer", input: { action: "key", text: "ctrl+s" } },
          { type: "tool_use", id: "t3", name: "computer", input: { action: "left_click_drag", start_coordinate: [1, 2], coordinate: [3, 4] } },
          { type: "tool_use", id: "t4", name: "bash", input: { command: "ls" } },
          { type: "tool_use", id: "t5", name: "task_complete", input: { summary: "done" } },
        ],
        stop_reason: "tool_use",
      },
    ]);
    const a = new AnthropicAdapter(init(fn));
    const d = await a.start("x", SCREENSHOT);
    if (d.kind !== "act") throw new Error();
    expect(d.invocations[0]).toMatchObject({ action: { type: "scroll", direction: "down", amount: 5 } });
    expect(d.invocations[1]).toMatchObject({ action: { type: "key", key: "ctrl+s" } });
    expect(d.invocations[2]).toMatchObject({ action: { type: "left_click_drag", startX: 1, startY: 2, x: 3, y: 4 } });
    expect(d.invocations[3]).toMatchObject({ tool: "bash", command: "ls" });
    expect(d.invocations[4]).toMatchObject({ tool: "task_complete", summary: "done" });
  });
});

describe("OpenAIAdapter", () => {
  it("maps computer_call actions, safety checks, and function calls", async () => {
    const { fn, calls } = mockFetch([
      {
        id: "resp_1",
        output: [
          {
            type: "computer_call",
            call_id: "cc_1",
            action: { type: "click", x: 50, y: 60, button: "left" },
            pending_safety_checks: [{ id: "sc1", message: "may be sensitive" }],
          },
          { type: "function_call", call_id: "fc_1", name: "update_memory", arguments: '{"kind":"fact","content":"note"}' },
        ],
      },
      { id: "resp_2", output: [{ type: "message", content: [{ type: "output_text", text: "finished" }] }] },
    ]);
    const a = new OpenAIAdapter(init(fn));
    const d1 = await a.start("task", SCREENSHOT);
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]).toMatchObject({ id: "cc_1", tool: "computer", action: { type: "left_click", x: 50, y: 60 } });
    expect(d1.invocations[0]!.needsConfirmation).toContain("may be sensitive");
    expect(d1.invocations[1]).toMatchObject({ tool: "update_memory", memoryKind: "fact", content: "note" });

    const d2 = await a.next([
      { id: "cc_1", tool: "computer", output: "ok", screenshotB64: SCREENSHOT },
      { id: "fc_1", tool: "update_memory", output: "saved" },
    ]);
    expect(d2).toEqual({ kind: "final", text: "finished" });

    const second = calls[1]!.body;
    expect(second.previous_response_id).toBe("resp_1");
    const ccOut = second.input.find((i: any) => i.type === "computer_call_output");
    expect(ccOut.call_id).toBe("cc_1");
    expect(ccOut.acknowledged_safety_checks).toHaveLength(1);
    expect(ccOut.output.image_url).toContain(SCREENSHOT);
    const fcOut = second.input.find((i: any) => i.type === "function_call_output");
    expect(fcOut).toMatchObject({ call_id: "fc_1", output: "saved" });
  });

  it("maps scroll pixels to wheel clicks and keypress to chords", async () => {
    const { fn } = mockFetch([
      {
        id: "r",
        output: [
          { type: "computer_call", call_id: "c1", action: { type: "scroll", x: 5, y: 6, scroll_x: 0, scroll_y: -240 } },
          { type: "computer_call", call_id: "c2", action: { type: "keypress", keys: ["CTRL", "A"] } },
          { type: "computer_call", call_id: "c3", action: { type: "drag", path: [{ x: 1, y: 2 }, { x: 9, y: 9 }] } },
        ],
      },
    ]);
    const a = new OpenAIAdapter(init(fn));
    const d = await a.start("x", SCREENSHOT);
    if (d.kind !== "act") throw new Error();
    expect(d.invocations[0]).toMatchObject({ action: { type: "scroll", direction: "up", amount: 4 } });
    expect(d.invocations[1]).toMatchObject({ action: { type: "key", key: "CTRL+A" } });
    expect(d.invocations[2]).toMatchObject({ action: { type: "left_click_drag", startX: 1, startY: 2, x: 9, y: 9 } });
  });
});

describe("GeminiAdapter", () => {
  it("scales 0-999 coordinates to pixels and builds function_result", async () => {
    const { fn, calls } = mockFetch([
      {
        id: "int_1",
        steps: [
          { type: "function_call", id: "g1", name: "click_at", arguments: { x: 500, y: 500 } },
        ],
      },
      { id: "int_2", steps: [{ type: "model_output", content: [{ type: "text", text: "ok done" }] }] },
    ]);
    const a = new GeminiAdapter(init(fn));
    const d1 = await a.start("task", SCREENSHOT);
    if (d1.kind !== "act") throw new Error();
    // 500/1000 * 1280 = 640 ; 500/1000 * 800 = 400
    expect(d1.invocations[0]).toMatchObject({ tool: "computer", action: { type: "left_click", x: 640, y: 400 } });

    const d2 = await a.next([{ id: "g1", tool: "computer", output: "ok", screenshotB64: SCREENSHOT }]);
    expect(d2).toEqual({ kind: "final", text: "ok done" });

    const second = calls[1]!.body;
    expect(second.previous_interaction_id).toBe("int_1");
    expect(second.input[0]).toMatchObject({ type: "function_result", name: "click_at", call_id: "g1" });
    expect(second.input[0].result.some((r: any) => r.type === "image")).toBe(true);
  });

  it("expands type_text_at into a batch and honors safety decisions", async () => {
    const { fn } = mockFetch([
      {
        id: "i1",
        steps: [
          {
            type: "function_call",
            id: "g1",
            name: "type_text_at",
            arguments: { x: 100, y: 100, text: "hello", press_enter: true },
          },
          {
            type: "function_call",
            id: "g2",
            name: "click_at",
            arguments: { x: 0, y: 0 },
            safety_decision: { decision: "require_confirmation", explanation: "sensitive click" },
          },
        ],
      },
    ]);
    const a = new GeminiAdapter(init(fn));
    const d = await a.start("x", SCREENSHOT);
    if (d.kind !== "act") throw new Error();
    const batch = d.invocations[0]!;
    if (batch.tool !== "computer" || batch.action.type !== "batch") throw new Error("expected batch");
    expect(batch.action.steps.map((s) => s.type)).toEqual(["left_click", "key", "key", "type", "key"]);
    expect(d.invocations[1]!.needsConfirmation).toContain("sensitive click");
  });
});

describe("GenericAdapter", () => {
  it("parses JSON actions (with fences) and finishes on done", async () => {
    const { fn } = mockFetch([
      { choices: [{ message: { content: '```json\n{"thought":"look","computer":{"type":"screenshot"}}\n```' } }] },
      { choices: [{ message: { content: '{"done":true,"message":"finished the job"}' } }] },
    ]);
    const a = new GenericAdapter(init(fn));
    const d1 = await a.start("task", SCREENSHOT);
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]).toMatchObject({ tool: "computer", action: { type: "screenshot" } });
    const d2 = await a.next([{ id: d1.invocations[0]!.id, tool: "computer", output: "ok", screenshotB64: SCREENSHOT }]);
    expect(d2).toEqual({ kind: "final", text: "finished the job" });
  });

  it("nudges the model after invalid JSON, then gives up gracefully", async () => {
    const { fn, calls } = mockFetch([
      { choices: [{ message: { content: "I think I should click somewhere" } }] },
      { choices: [{ message: { content: "still not json" } }] },
      { choices: [{ message: { content: "nope" } }] },
    ]);
    const a = new GenericAdapter(init(fn));
    const d = await a.start("task", SCREENSHOT);
    expect(d.kind).toBe("final");
    expect(calls.length).toBe(3);
  });

  it("parses bash and collaboration actions", async () => {
    const { fn } = mockFetch([
      { choices: [{ message: { content: '{"bash":{"command":"ls ~/workspace"}}' } }] },
    ]);
    const a = new GenericAdapter(init(fn));
    const d = await a.start("task", SCREENSHOT);
    if (d.kind !== "act") throw new Error();
    expect(d.invocations[0]).toMatchObject({ tool: "bash", command: "ls ~/workspace" });
  });

  it("parses send_message as an explicit chat update", async () => {
    const { fn } = mockFetch([
      { choices: [{ message: { content: '{"thought":"blocked","send_message":{"text":"Need you to take over for 2FA."}}' } }] },
    ]);
    const a = new GenericAdapter(init(fn));
    const d = await a.start("task", SCREENSHOT);
    if (d.kind !== "act") throw new Error();
    expect(d.invocations[0]).toMatchObject({ tool: "send_message", text: "Need you to take over for 2FA." });
  });

  it("sends screenshots as image_url for vision endpoints", async () => {
    const { fn, calls } = mockFetch([
      { choices: [{ message: { content: '{"done":true,"message":"ok"}' } }] },
    ]);
    const a = new GenericAdapter(init(fn, { model: "grok-4", baseUrl: "https://api.x.ai/v1" }));
    await a.start("task", SCREENSHOT);
    const content = calls[0]!.body.messages.at(-1).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((p: { type: string }) => p.type === "image_url")).toBe(true);
    expect(calls[0]!.body.thinking).toBeUndefined();
  });

  it("uses text-only payloads and disables thinking for DeepSeek", async () => {
    const { fn, calls } = mockFetch([
      { choices: [{ message: { content: '{"bash":{"command":"ls ~/workspace"}}' } }] },
    ]);
    const a = new GenericAdapter(
      init(fn, { model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1" }),
    );
    const d = await a.start("search google", SCREENSHOT);
    if (d.kind !== "act") throw new Error();
    expect(d.invocations[0]).toMatchObject({ tool: "bash" });
    expect(typeof calls[0]!.body.messages.at(-1).content).toBe("string");
    expect(String(calls[0]!.body.messages.at(-1).content)).toContain("text-only");
    expect(calls[0]!.body.thinking).toEqual({ type: "disabled" });
    expect(String(calls[0]!.body.messages[0].content)).toContain("cannot receive screenshots");
  });

  it("retries without images when the endpoint rejects image_url", async () => {
    const calls: { body: any }[] = [];
    let i = 0;
    const fn = vi.fn(async (_url: any, init?: any) => {
      const body = JSON.parse(init?.body ?? "{}");
      calls.push({ body });
      i += 1;
      if (i === 1) {
        return new Response(
          JSON.stringify({ error: { message: "unknown variant `image_url`, expected `text`" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"done":true,"message":"ok"}' } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const a = new GenericAdapter(init(fn, { model: "local-text", baseUrl: "http://127.0.0.1:9/v1" }));
    const d = await a.start("task", SCREENSHOT);
    expect(d).toEqual({ kind: "final", text: "ok" });
    expect(calls.length).toBe(2);
    expect(typeof calls[1]!.body.messages.find((m: { role: string }) => m.role === "user").content).toBe("string");
  });
});
