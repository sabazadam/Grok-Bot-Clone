import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "./db.js";
import * as store from "./store.js";

beforeEach(() => {
  useTestDb();
});

function makeAgent(overrides: Partial<store.NewAgent> = {}) {
  return store.createAgent({
    name: "Nova",
    roleTitle: "Researcher",
    instructions: "Do research.",
    avatarColor: "#0a84ff",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    collaborationEnabled: true,
    stealthBrowsing: true,
    ...overrides,
  });
}

describe("agent store", () => {
  it("creates and reads back stealth + hidden defaults", () => {
    const a = makeAgent();
    expect(a.stealthBrowsing).toBe(true);
    expect(a.hidden).toBe(false);
    const got = store.getAgent(a.id)!;
    expect(got.name).toBe("Nova");
    expect(got.stealthBrowsing).toBe(true);
    expect(got.isTeamLead).toBe(false);
  });

  it("persists team lead and skills", () => {
    const a = makeAgent({ isTeamLead: true });
    expect(a.isTeamLead).toBe(true);
    const skill = store.createSkill({
      name: "Weekly account health",
      description: "Portfolio review",
      instructions: "Pull CRM. Do not contact customers.",
      createdByAgentId: a.id,
    });
    expect(store.agentHasSkill(a.id, skill.id)).toBe(true);
    expect(store.listEnabledSkillsForAgent(a.id).map((s) => s.name)).toEqual(["Weekly account health"]);
    store.setAgentSkill(a.id, skill.id, false);
    expect(store.agentHasSkill(a.id, skill.id)).toBe(false);
  });

  it("schedules routines and lists due ones", () => {
    const a = makeAgent();
    const r = store.createRoutine({
      agentId: a.id,
      name: "Morning digest",
      prompt: "Summarize inbox",
      intervalMinutes: 30,
    });
    expect(r.enabled).toBe(true);
    expect(r.nextRunAt).toBeGreaterThan(Date.now());
    expect(store.listDueRoutines(Date.now()).map((x) => x.id)).not.toContain(r.id);
    expect(store.listDueRoutines(Date.now() + 31 * 60_000).map((x) => x.id)).toContain(r.id);
  });

  it("accepts a natural-language morning schedule", () => {
    const a = makeAgent({ name: "Piper" });
    const r = store.createRoutine({
      agentId: a.id,
      name: "Inbox",
      prompt: "Summarize inbox",
      schedule: "every morning",
    });
    expect(r.scheduleLabel).toMatch(/8 AM/i);
    expect(r.timezone).toBeTruthy();
    expect(r.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("creates a reusable hierarchical agent DM that is not a direct chat", () => {
    const lead = makeAgent({ name: "Lead", isTeamLead: true, team: "Social Media" });
    const worker = makeAgent({ name: "Worker", team: "Social Media" });
    expect(lead.team).toBe("Social Media");
    const a = store.ensureAgentDm(lead.id, worker.id);
    const b = store.ensureAgentDm(worker.id, lead.id);
    expect(a.id).toBe(b.id);
    expect(a.kind).toBe("agent_dm");
    expect(a.agentIds.slice().sort()).toEqual([lead.id, worker.id].sort());
    expect(store.directConversationForAgent(worker.id)?.id).not.toBe(a.id);
    const direct = store.ensureDirectConversation(lead.id);
    const marker = store.addMessage({
      conversationId: direct.id,
      sender: { kind: "agent", agentId: lead.id },
      kind: "text",
      text: "Messaged Worker",
      relatedConversationId: a.id,
    });
    expect(store.listMessages(direct.id).find((m) => m.id === marker.id)?.relatedConversationId).toBe(a.id);
  });

  it("honors stealthBrowsing=false and updates it", () => {
    const a = makeAgent({ stealthBrowsing: false });
    expect(a.stealthBrowsing).toBe(false);
    const updated = store.updateAgent(a.id, { stealthBrowsing: true })!;
    expect(updated.stealthBrowsing).toBe(true);
  });

  it("hides and unhides an agent", () => {
    const a = makeAgent();
    expect(store.setAgentHidden(a.id, true)!.hidden).toBe(true);
    expect(store.setAgentHidden(a.id, false)!.hidden).toBe(false);
  });
});
