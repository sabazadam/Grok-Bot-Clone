import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { runDelegation, composeGoal, type RunChildOptions, type DelegateContext } from "./delegate.js";
import { newTurnBudget } from "./orchestrator.js";
import type { ToolInvocation } from "../models/types.js";

beforeEach(() => {
  useTestDb();
});

const baseAgent: store.NewAgent = {
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

function ctxFor(parentId: string, depth = 0): DelegateContext {
  return { parentAgent: store.getAgent(parentId)!, rootMessageId: "root1", parentConversationId: "pc", depth };
}

/** A fake child runner that immediately "completes" the delegation with a summary. */
function fakeRunner(record: RunChildOptions[], summary = "did the work", steps = 3) {
  return async (o: RunChildOptions) => {
    record.push(o);
    store.updateDelegation(o.delegationId, {
      childTaskId: "task-" + o.agentId,
      status: "done",
      resultSummary: `${summary} for ${o.goal.slice(0, 20)}`,
      stepCount: steps,
      finishedAt: Date.now(),
    });
  };
}

function delegateInv(tasks: any[], concurrency?: number): Extract<ToolInvocation, { tool: "delegate_task" }> {
  return { id: "d1", tool: "delegate_task", tasks, concurrency };
}

describe("runDelegation", () => {
  it("delegates to an existing teammate with isolated context (goal only, no parent transcript)", async () => {
    const lead = store.createAgent(baseAgent);
    const researcher = store.createAgent({ ...baseAgent, name: "Researcher", roleTitle: "Researcher", isTeamLead: false });
    newTurnBudget("root1");
    const calls: RunChildOptions[] = [];

    const { results, output } = await runDelegation(
      ctxFor(lead.id),
      delegateInv([{ agentName: "Researcher", goal: "dig into X", context: "some background" }]),
      fakeRunner(calls),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ childAgentName: "Researcher", status: "done", steps: 3 });
    expect(output).toContain("Researcher");
    // isolated context: the child prompt contains only the goal + context we passed.
    expect(calls[0]!.goal).toBe("dig into X\n\nContext:\nsome background");
    expect(calls[0]!.goal).not.toContain("root1");
    // persisted hierarchy
    const rows = store.listDelegationsByParent(lead.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.childAgentId).toBe(researcher.id);
    expect(rows[0]!.status).toBe("done");
    // a private thread was created and carries the goal message
    const thread = store.agentDmFor(lead.id, researcher.id)!;
    expect(thread).toBeTruthy();
    expect(store.listMessages(thread.id).some((m) => m.text.includes("dig into X"))).toBe(true);
  });

  it("spawns a permanent specialist when asked (kept in roster, badged)", async () => {
    const lead = store.createAgent(baseAgent);
    newTurnBudget("root1");
    const calls: RunChildOptions[] = [];

    const { results } = await runDelegation(
      ctxFor(lead.id),
      delegateInv([{ spawn: { name: "Scout", roleTitle: "Researcher", toolPolicy: "research" }, goal: "find sources" }]),
      fakeRunner(calls),
    );

    expect(results[0]!.status).toBe("done");
    const scout = store.getAgentByName("Scout")!;
    expect(scout).toBeTruthy();
    expect(scout.agentKind).toBe("specialist");
    expect(scout.parentAgentId).toBe(lead.id);
    expect(scout.toolPolicy).toBe("research");
    // permanent: still present in the roster listing
    expect(store.listAgents().map((a) => a.id)).toContain(scout.id);
  });

  it("runs a parallel batch and respects the concurrency cap", async () => {
    const lead = store.createAgent(baseAgent);
    store.createAgent({ ...baseAgent, name: "A", isTeamLead: false });
    store.createAgent({ ...baseAgent, name: "B", isTeamLead: false });
    store.createAgent({ ...baseAgent, name: "C", isTeamLead: false });
    newTurnBudget("root1");

    let active = 0;
    let peak = 0;
    const runner = async (o: RunChildOptions) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      store.updateDelegation(o.delegationId, { status: "done", resultSummary: "ok", stepCount: 1, finishedAt: Date.now() });
      active--;
    };

    const { results } = await runDelegation(
      ctxFor(lead.id),
      delegateInv(
        [
          { agentName: "A", goal: "g1" },
          { agentName: "B", goal: "g2" },
          { agentName: "C", goal: "g3" },
        ],
        2,
      ),
      runner,
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "done")).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("enforces max spawn depth (leaf sub-agents cannot sub-delegate)", async () => {
    const lead = store.createAgent(baseAgent);
    store.createAgent({ ...baseAgent, name: "Researcher", isTeamLead: false });
    newTurnBudget("root1");
    const calls: RunChildOptions[] = [];

    // depth 1 is already at the default max (1); a child delegating again would be depth 2 → refused.
    const { results, output } = await runDelegation(
      ctxFor(lead.id, 1),
      delegateInv([{ agentName: "Researcher", goal: "nested" }]),
      fakeRunner(calls),
    );

    expect(results).toHaveLength(0);
    expect(output).toMatch(/maximum spawn depth/i);
    expect(calls).toHaveLength(0);
  });

  it("marks tasks skipped_budget once the per-request turn budget is exhausted", async () => {
    const lead = store.createAgent(baseAgent);
    for (const n of ["A", "B"]) store.createAgent({ ...baseAgent, name: n, isTeamLead: false });
    // Exhaust the budget: default MAX_AGENT_TURNS = 8.
    newTurnBudget("root1");
    const { consumeTurn } = await import("./orchestrator.js");
    for (let i = 0; i < 8; i++) consumeTurn("root1");
    const calls: RunChildOptions[] = [];

    const { results } = await runDelegation(
      ctxFor(lead.id),
      delegateInv([{ agentName: "A", goal: "g1" }, { agentName: "B", goal: "g2" }]),
      fakeRunner(calls),
    );

    expect(results.every((r) => r.status === "skipped_budget")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("reports a structured failure for an unknown teammate", async () => {
    const lead = store.createAgent(baseAgent);
    newTurnBudget("root1");
    const { results } = await runDelegation(
      ctxFor(lead.id),
      delegateInv([{ agentName: "Ghost", goal: "x" }]),
      fakeRunner([]),
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.summary).toMatch(/no teammate named/i);
  });

  it("composeGoal appends context only when present", () => {
    expect(composeGoal({ goal: "do X" } as any)).toBe("do X");
    expect(composeGoal({ goal: "do X", context: "bg" } as any)).toBe("do X\n\nContext:\nbg");
  });
});
