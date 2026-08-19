import { describe, it, expect } from "vitest";
import { customTools, parseCustomToolCall } from "./toolset.js";

describe("customTools", () => {
  it("always exposes send_message so agents can report only when necessary", () => {
    const names = customTools(false).map((t) => t.name);
    expect(names).toContain("send_message");
    expect(names).toContain("task_complete");
    expect(names).not.toContain("send_message_to_agent");
    expect(customTools(true).map((t) => t.name)).toContain("send_message_to_agent");
  });

  it("parses send_message", () => {
    expect(parseCustomToolCall("1", "send_message", { text: "Need takeover for 2FA." })).toEqual({
      id: "1",
      tool: "send_message",
      text: "Need takeover for 2FA.",
    });
  });
});
