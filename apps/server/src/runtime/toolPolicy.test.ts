import { describe, it, expect } from "vitest";
import { resolveAllowedTools, isToolAllowed, describeAllowedTools } from "./toolPolicy.js";
import { ALWAYS_ALLOWED_TOOLS } from "@grokbot/shared";

type PolicyAgent = { toolPolicy: any; toolAllow?: string[]; collaborationEnabled: boolean };

const agent = (over: Partial<PolicyAgent> = {}): PolicyAgent => ({
  toolPolicy: "full",
  collaborationEnabled: true,
  ...over,
});

describe("resolveAllowedTools", () => {
  it("full policy grants every gateable tool plus always-allowed", () => {
    const allowed = resolveAllowedTools(agent({ toolPolicy: "full" }));
    for (const t of ["computer", "bash", "create_agent", "create_routine", "save_skill", "call_plugin", "delegate_task", "send_message_to_agent"]) {
      expect(allowed.has(t)).toBe(true);
    }
    for (const t of ALWAYS_ALLOWED_TOOLS) expect(allowed.has(t)).toBe(true);
  });

  it("review_only excludes computer and roster-mutating tools", () => {
    const allowed = resolveAllowedTools(agent({ toolPolicy: "review_only" }));
    expect(allowed.has("bash")).toBe(true);
    expect(allowed.has("call_plugin")).toBe(true);
    expect(allowed.has("computer")).toBe(false);
    expect(allowed.has("create_agent")).toBe(false);
    expect(allowed.has("delegate_task")).toBe(false);
    // always-allowed reporting tools still present
    expect(allowed.has("send_message")).toBe(true);
    expect(allowed.has("task_complete")).toBe(true);
  });

  it("research grants browse + read + handoff but not create_agent/save_skill", () => {
    const allowed = resolveAllowedTools(agent({ toolPolicy: "research" }));
    expect(allowed.has("computer")).toBe(true);
    expect(allowed.has("bash")).toBe(true);
    expect(allowed.has("send_message_to_agent")).toBe(true);
    expect(allowed.has("create_agent")).toBe(false);
    expect(allowed.has("save_skill")).toBe(false);
  });

  it("browser_only excludes bash", () => {
    const allowed = resolveAllowedTools(agent({ toolPolicy: "browser_only" }));
    expect(allowed.has("computer")).toBe(true);
    expect(allowed.has("bash")).toBe(false);
  });

  it("custom uses the explicit allow-list (ignoring unknown names)", () => {
    const allowed = resolveAllowedTools(agent({ toolPolicy: "custom", toolAllow: ["bash", "not_a_tool", "computer"] }));
    expect(allowed.has("bash")).toBe(true);
    expect(allowed.has("computer")).toBe(true);
    expect(allowed.has("not_a_tool")).toBe(false);
    expect(allowed.has("create_agent")).toBe(false);
  });

  it("collaboration off removes messaging/delegation even under full", () => {
    const allowed = resolveAllowedTools(agent({ toolPolicy: "full", collaborationEnabled: false }));
    expect(allowed.has("send_message_to_agent")).toBe(false);
    expect(allowed.has("delegate_task")).toBe(false);
    expect(allowed.has("bash")).toBe(true);
  });
});

describe("isToolAllowed / describeAllowedTools", () => {
  it("isToolAllowed matches the resolved set", () => {
    const a = agent({ toolPolicy: "review_only" });
    expect(isToolAllowed(a, "bash")).toBe(true);
    expect(isToolAllowed(a, "computer")).toBe(false);
    expect(isToolAllowed(a, "task_complete")).toBe(true);
  });

  it("describeAllowedTools lists gateable tools only", () => {
    const desc = describeAllowedTools(agent({ toolPolicy: "browser_only" }));
    expect(desc).toContain("computer");
    expect(desc).not.toContain("bash");
    expect(desc).not.toContain("send_message"); // always-allowed, not gateable
  });
});
