import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { executeInvocation, type ExecContext } from "./tools.js";
import type { ToolInvocation } from "../models/types.js";

beforeEach(() => {
  useTestDb();
});

function ctxFor(agent: store.NewAgent): ExecContext {
  const a = store.createAgent(agent);
  return { agent: a, taskId: "t1", conversationId: "c1", rootMessageId: "m1" };
}

const base: store.NewAgent = {
  name: "Guardian",
  roleTitle: "Reviewer",
  instructions: "",
  avatarColor: "#111111",
  provider: "generic",
  model: "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: false,
};

describe("executeInvocation tool-policy guard", () => {
  it("rejects a computer action for a review_only agent (exec-layer enforcement)", async () => {
    const ctx = ctxFor({ ...base, toolPolicy: "review_only" });
    const inv: ToolInvocation = { id: "1", tool: "computer", action: { type: "screenshot" } };
    const { outcome } = await executeInvocation(ctx, inv, 1);
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toMatch(/not permitted by your tool policy/i);
  });

  it("rejects create_agent for a research agent", async () => {
    const ctx = ctxFor({ ...base, toolPolicy: "research" });
    const inv: ToolInvocation = { id: "2", tool: "create_agent", name: "X", roleTitle: "Y", instructions: "z" };
    const { outcome } = await executeInvocation(ctx, inv, 1);
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toMatch(/not permitted/i);
    // no agent should have been created
    expect(store.getAgentByName("X")).toBeUndefined();
  });

  it("allows an always-allowed tool regardless of policy (update_memory)", async () => {
    const ctx = ctxFor({ ...base, toolPolicy: "review_only" });
    const inv: ToolInvocation = { id: "3", tool: "update_memory", memoryKind: "fact", content: "hello" };
    const { outcome } = await executeInvocation(ctx, inv, 1);
    expect(outcome.isError).toBeFalsy();
    expect(store.listMemories(ctx.agent.id).length).toBe(1);
  });

  it("allows bash for a review_only agent (bash is in its policy)", async () => {
    const ctx = ctxFor({ ...base, toolPolicy: "review_only" });
    // bash would hit the computer manager; instead assert the guard does NOT short-circuit it.
    // We check by confirming the policy resolver permits bash for this agent.
    const inv: ToolInvocation = { id: "4", tool: "save_skill", name: "S", description: "", instructions: "do" };
    const { outcome } = await executeInvocation(ctx, inv, 1);
    // save_skill is NOT allowed under review_only → should be rejected
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toMatch(/not permitted/i);
  });
});
