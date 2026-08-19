/**
 * End-to-end-ish delegation test using the REAL runner + mock-scripted model, with the Docker
 * computer + provisioning stubbed (no Docker needed). Proves: a Team Lead's delegate_task spawns/
 * uses specialists, they run via the real runner, and only the aggregated structured result comes
 * back — the parent's user chat is NOT polluted with the children's transcripts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../computer/manager.js", () => ({
  computerManager: {
    ensureRunning: vi.fn(async () => ({ state: "running", actuatorPort: 1, novncPort: 2, containerId: "c", resolution: "1280x800" })),
    screenshot: vi.fn(async () => Buffer.from("png")),
    act: vi.fn(async () => ({ ok: true })),
    exec: vi.fn(async () => ({ ok: true, exitCode: 0, output: "" })),
    abortExec: vi.fn(async () => {}),
    syncBrowserConfig: vi.fn(async () => {}),
  },
}));

vi.mock("../agents/service.js", async (orig) => {
  const actual = await orig<typeof import("../agents/service.js")>();
  return {
    ...actual,
    makeRoomForComputer: vi.fn(async () => {}),
    syncBrowserConfig: vi.fn(async () => {}),
  };
});

import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { runDelegation, type DelegateContext } from "./delegate.js";
import { newTurnBudget } from "./orchestrator.js";
import type { ToolInvocation } from "../models/types.js";

beforeEach(() => {
  useTestDb();
});

const mockAgent: store.NewAgent = {
  name: "Lead",
  roleTitle: "Team Lead",
  instructions: "",
  avatarColor: "#111111",
  provider: "generic",
  model: "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: false,
  isTeamLead: true,
};

function delegateInv(tasks: any[], concurrency?: number): Extract<ToolInvocation, { tool: "delegate_task" }> {
  return { id: "d1", tool: "delegate_task", tasks, concurrency };
}

describe("delegation via the real runner (mock model, stubbed computer)", () => {
  it("runs two specialists in parallel and returns aggregated results without polluting the parent chat", async () => {
    const lead = store.createAgent(mockAgent);
    const a = store.createAgent({ ...mockAgent, name: "Researcher", isTeamLead: false });
    const b = store.createAgent({ ...mockAgent, name: "Coder", isTeamLead: false });
    const parentConv = store.createConversation("direct", "Lead", [lead.id]);
    newTurnBudget("rootX");

    const ctx: DelegateContext = { parentAgent: lead, rootMessageId: "rootX", parentConversationId: parentConv.id, depth: 0 };
    const { results, output, firstThreadId } = await runDelegation(
      ctx,
      delegateInv(
        [
          { agentName: "Researcher", goal: "research the market" },
          { agentName: "Coder", goal: "scaffold the app" },
        ],
        2,
      ),
    );

    expect(results).toHaveLength(2);
    // mock-scripted teammate with no directives ACKs → delegation completes as "done"
    expect(results.map((r) => r.status)).toEqual(["done", "done"]);
    expect(output).toContain("Researcher");
    expect(output).toContain("Coder");
    expect(firstThreadId).toBeTruthy();

    // parent's user chat has NO messages from the children (context isolation)
    const parentMsgs = store.listMessages(parentConv.id);
    expect(parentMsgs.length).toBe(0);

    // hierarchy persisted
    const rows = store.listDelegationsByParent(lead.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(rows.map((r) => r.childAgentId).sort()).toEqual([a.id, b.id].sort());
  });

  it("spawns a permanent specialist through the real runner path", async () => {
    const lead = store.createAgent(mockAgent);
    const parentConv = store.createConversation("direct", "Lead", [lead.id]);
    newTurnBudget("rootY");

    const ctx: DelegateContext = { parentAgent: lead, rootMessageId: "rootY", parentConversationId: parentConv.id, depth: 0 };
    const { results } = await runDelegation(
      ctx,
      delegateInv([{ spawn: { name: "Nova", roleTitle: "Analyst", toolPolicy: "research" }, goal: "analyze logs" }]),
    );

    expect(results[0]!.status).toBe("done");
    const nova = store.getAgentByName("Nova")!;
    expect(nova.agentKind).toBe("specialist");
    expect(nova.parentAgentId).toBe(lead.id);
    expect(nova.toolPolicy).toBe("research");
  });
});
