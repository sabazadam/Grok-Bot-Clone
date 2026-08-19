import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";

const broadcast = vi.fn();
vi.mock("../bus.js", () => ({
  broadcast: (...args: unknown[]) => broadcast(...args),
}));

import { requestApproval } from "./approvals.js";

beforeEach(() => {
  useTestDb();
  broadcast.mockClear();
});

describe("requestApproval timeout", () => {
  it("rejects the approval and notifies clients when the user never answers", async () => {
    const agent = store.createAgent({
      name: "Nova",
      roleTitle: "Researcher",
      instructions: "",
      avatarColor: "#0a84ff",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      collaborationEnabled: true,
      stealthBrowsing: true,
    });
    const conv = store.ensureDirectConversation(agent.id);
    const task = store.createTask(agent.id, conv.id, "send the email");

    const decision = await requestApproval({
      taskId: task.id,
      agentId: agent.id,
      conversationId: conv.id,
      actionDescription: "Send email",
      actionJson: "{}",
      reason: "outbound mail",
      timeoutMs: 20,
    });

    expect(decision).toBe("timeout");
    const pending = store.listPendingApprovalsForAgent(agent.id);
    expect(pending).toHaveLength(0);
    expect(store.listApprovalsByConversation(conv.id)[0]?.status).toBe("rejected");
    expect(broadcast.mock.calls.some((call) => (call[0] as { type?: string }).type === "approval_resolved")).toBe(true);
  });
});
