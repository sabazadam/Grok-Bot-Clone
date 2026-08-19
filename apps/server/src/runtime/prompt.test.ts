import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { buildSystemPrompt, buildTaskPrompt } from "./prompt.js";

beforeEach(() => {
  useTestDb();
});

function makeAgent(overrides: Partial<store.NewAgent> = {}) {
  return store.createAgent({
    name: "Milo",
    roleTitle: "Coordinator",
    instructions: "Own the weekly review.",
    avatarColor: "#0a84ff",
    provider: "generic",
    model: "grok-4",
    collaborationEnabled: true,
    stealthBrowsing: true,
    ...overrides,
  });
}

describe("system prompt reporting policy", () => {
  it("tells the agent to stay silent in the sandbox and report only when necessary", () => {
    const agent = makeAgent();
    const prompt = buildSystemPrompt(agent);
    expect(prompt).toMatch(/report only when necessary/i);
    expect(prompt).toMatch(/Stay silent while you work/);
    expect(prompt).toMatch(/Clicks, typing, browsing, and shell commands are NOT chat messages/);
    expect(prompt).toMatch(/only come back when something needs the user/);
    expect(prompt).not.toMatch(/report back like a capable colleague/);
  });

  it("adds team-lead and skill sections when they apply", () => {
    const agent = makeAgent({ name: "Piper", isTeamLead: true });
    store.createSkill({
      name: "Weekly account health",
      description: "Portfolio review",
      instructions: "Pull CRM. Do not contact customers.",
      createdByAgentId: agent.id,
    });
    const prompt = buildSystemPrompt(store.getAgent(agent.id)!);
    expect(prompt).toMatch(/## Team lead/);
    expect(prompt).toMatch(/You coordinate/);
    expect(prompt).toMatch(/\/Weekly account health/);
    expect(prompt).toMatch(/Pull CRM/);
  });

  it("does not tell teammates they will always report back", () => {
    makeAgent({ name: "Scout", roleTitle: "Researcher" });
    const agent = makeAgent({ name: "Nova" });
    const prompt = buildSystemPrompt(agent);
    expect(prompt).toMatch(/reply only if a result is needed/);
    expect(prompt).toMatch(/Do not ping them with progress of your own sandbox work/);
    expect(prompt).not.toMatch(/report back to you/);
  });
});

describe("task prompt reporting policy", () => {
  it("user tasks: stay silent until a necessary update or result", () => {
    const agent = makeAgent();
    const conv = store.ensureDirectConversation(agent.id);
    const text = buildTaskPrompt(agent, conv, {
      agentId: agent.id,
      conversationId: conv.id,
      prompt: "Draft the weekly review.",
      rootMessageId: "root",
      triggeredBy: { kind: "user" },
    });
    expect(text).toMatch(/Stay silent until you have a necessary, task-related update or a finished result/);
  });

  it("teammate handoffs: work in sandbox, ACK if no reply is needed", () => {
    const scout = makeAgent({ name: "Scout" });
    const milo = makeAgent({ name: "Milo" });
    const conv = store.ensureDirectConversation(scout.id);
    const text = buildTaskPrompt(scout, conv, {
      agentId: scout.id,
      conversationId: conv.id,
      prompt: "FYI I already saved the file.",
      rootMessageId: "root",
      triggeredBy: { kind: "agent", agentId: milo.id },
    });
    expect(text).toMatch(/sandbox handoff/);
    expect(text).toMatch(/stay silent about routine actions/);
    expect(text).toMatch(/If no reply is needed, call task_complete with exactly "ACK"/);
  });
});
