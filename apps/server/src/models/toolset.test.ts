import { describe, it, expect } from "vitest";
import { customTools, parseCustomToolCall } from "./toolset.js";
import { ALWAYS_ALLOWED_TOOLS, GATEABLE_TOOLS } from "@grokbot/shared";

const ALL = new Set<string>([...GATEABLE_TOOLS, ...ALWAYS_ALLOWED_TOOLS]);
const NO_COLLAB = new Set<string>([...ALL].filter((t) => t !== "send_message_to_agent" && t !== "delegate_task"));

describe("customTools", () => {
  it("always exposes send_message so agents can report only when necessary", () => {
    const names = customTools(NO_COLLAB).map((t) => t.name);
    expect(names).toContain("send_message");
    expect(names).toContain("save_skill");
    expect(names).toContain("create_agent");
    expect(names).toContain("create_routine");
    expect(names).toContain("task_complete");
    expect(names).toContain("call_plugin");
    expect(names).not.toContain("send_message_to_agent");
    expect(customTools(ALL).map((t) => t.name)).toContain("send_message_to_agent");
  });

  it("filters custom tools by the allowed set (policy enforcement at the schema layer)", () => {
    const research = new Set<string>(["computer", "bash", "call_plugin", "send_message_to_agent", ...ALWAYS_ALLOWED_TOOLS]);
    const names = customTools(research).map((t) => t.name);
    expect(names).toContain("bash");
    expect(names).toContain("call_plugin");
    expect(names).toContain("send_message"); // always allowed
    expect(names).not.toContain("create_agent");
    expect(names).not.toContain("save_skill");
    expect(names).not.toContain("create_routine");
  });

  it("parses send_message", () => {
    expect(parseCustomToolCall("1", "send_message", { text: "Need takeover for 2FA." })).toEqual({
      id: "1",
      tool: "send_message",
      text: "Need takeover for 2FA.",
    });
  });

  it("parses call_plugin", () => {
    expect(
      parseCustomToolCall("9", "call_plugin", {
        pluginId: "hook1",
        toolName: "search",
        arguments: { q: "inbox" },
      }),
    ).toEqual({
      id: "9",
      tool: "call_plugin",
      pluginId: "hook1",
      toolName: "search",
      arguments: { q: "inbox" },
    });
  });
});
