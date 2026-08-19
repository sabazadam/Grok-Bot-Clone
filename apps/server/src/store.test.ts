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
