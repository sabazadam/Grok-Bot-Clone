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
  it("persists an official face shape", () => {
    const a = makeAgent({ name: "Facey", avatarShape: "cloud" });
    expect(store.getAgent(a.id)?.avatarShape).toBe("cloud");
    expect(store.updateAgent(a.id, { avatarShape: "pill" })?.avatarShape).toBe("pill");
  });

  it("promotes mock-scripted agents onto a live model", () => {
    const a = makeAgent({ name: "Mocky", model: "mock-scripted", provider: "generic" });
    const changed = store.promoteMockAgents("generic", "deepseek-v4-flash");
    expect(changed.map((x) => x.id)).toContain(a.id);
    expect(store.getAgent(a.id)?.model).toBe("deepseek-v4-flash");
  });

  it("assigns distinct official face shapes to agents that lack one", () => {
    const a = makeAgent({ name: "NoFace" });
    const b = makeAgent({ name: "AlsoNoFace", avatarColor: "#111111" });
    const changed = store.assignMissingFaceShapes();
    expect(changed.map((x) => x.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const shapes = [store.getAgent(a.id)?.avatarShape, store.getAgent(b.id)?.avatarShape];
    expect(shapes[0]).toBeTruthy();
    expect(shapes[1]).toBeTruthy();
    expect(shapes[0]).not.toBe(shapes[1]);
  });

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

  it("pins conversations above recents", () => {
    const a = makeAgent({ name: "Alpha" });
    const b = makeAgent({ name: "Beta" });
    const ca = store.ensureDirectConversation(a.id);
    const cb = store.ensureDirectConversation(b.id);
    store.addMessage({ conversationId: ca.id, sender: { kind: "user" }, kind: "text", text: "older" });
    store.addMessage({ conversationId: cb.id, sender: { kind: "user" }, kind: "text", text: "newer" });
    const pinned = store.setConversationPinned(ca.id, true)!;
    expect(pinned.pinned).toBe(true);
    expect(store.listConversations()[0]!.id).toBe(ca.id);
    store.setConversationPinned(ca.id, false);
    store.setConversationPinned(cb.id, true);
    expect(store.listConversations()[0]!.id).toBe(cb.id);
  });

  it("stores attachments and toggles reactions", () => {
    const a = makeAgent({ name: "Piper" });
    const conv = store.ensureDirectConversation(a.id);
    const msg = store.addMessage({
      conversationId: conv.id,
      sender: { kind: "user" },
      kind: "text",
      text: "see this",
      attachments: [{ id: "att1", name: "brief.pdf", mime: "application/pdf", url: "/uploads/att1_brief.pdf", size: 1200 }],
    });
    expect(store.getMessage(msg.id)?.attachments?.[0]?.name).toBe("brief.pdf");
    expect(store.toggleMessageReaction(msg.id, "👍")?.reactions).toEqual({ "👍": 1 });
    expect(store.toggleMessageReaction(msg.id, "👍")?.reactions).toBeUndefined();
  });

  it("searches user-visible messages and skips agent DMs", () => {
    const lead = makeAgent({ name: "Lead" });
    const worker = makeAgent({ name: "Worker" });
    const direct = store.ensureDirectConversation(lead.id);
    const dm = store.ensureAgentDm(lead.id, worker.id);
    store.addMessage({
      conversationId: direct.id,
      sender: { kind: "user" },
      kind: "text",
      text: "quarterly revenue report please",
    });
    store.addMessage({
      conversationId: dm.id,
      sender: { kind: "agent", agentId: lead.id },
      kind: "text",
      text: "quarterly revenue secret",
    });
    const hits = store.searchMessages("revenue");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.conversationId).toBe(direct.id);
    expect(store.searchMessages("x")).toEqual([]);
  });

  it("skips system stop lines and matches attachment names", () => {
    const a = makeAgent({ name: "Piper" });
    const conv = store.ensureDirectConversation(a.id);
    store.addMessage({
      conversationId: conv.id,
      sender: { kind: "system" },
      kind: "text",
      text: "Stopped. In-progress work was cancelled.",
    });
    store.addMessage({
      conversationId: conv.id,
      sender: { kind: "user" },
      kind: "text",
      text: "see this",
      attachments: [{ id: "att1", name: "q3-brief.pdf", mime: "application/pdf", url: "/uploads/att1_q3.pdf", size: 800 }],
    });
    expect(store.searchMessages("Stopped")).toEqual([]);
    expect(store.searchMessages("q3-brief").map((h) => h.conversationId)).toEqual([conv.id]);
  });

  it("reconciles ghost waiting/working statuses", () => {
    const waiting = makeAgent({ name: "GhostWait" });
    const working = makeAgent({ name: "GhostWork" });
    const realWait = makeAgent({ name: "RealWait" });
    const realWork = makeAgent({ name: "RealWork" });
    const starting = makeAgent({ name: "Booting" });
    store.setAgentStatus(waiting.id, "waiting_approval");
    store.setAgentStatus(working.id, "working");
    store.setAgentStatus(realWait.id, "idle");
    store.setAgentStatus(realWork.id, "idle");
    store.setAgentStatus(starting.id, "starting");
    const conv = store.ensureDirectConversation(realWait.id);
    store.createApproval({
      conversationId: conv.id,
      agentId: realWait.id,
      taskId: "t1",
      actionJson: "{}",
      actionDescription: "send email",
      reason: "needs you",
    });
    store.createTask(realWork.id, conv.id, "research");
    const changes = store.reconcileAgentStatuses();
    expect(store.getAgent(waiting.id)?.status).toBe("idle");
    expect(store.getAgent(working.id)?.status).toBe("idle");
    expect(store.getAgent(realWait.id)?.status).toBe("waiting_approval");
    expect(store.getAgent(realWork.id)?.status).toBe("working");
    expect(store.getAgent(starting.id)?.status).toBe("starting");
    expect(changes.map((c) => c.agentId).sort()).toEqual([waiting.id, working.id, realWait.id, realWork.id].sort());
  });

  it("copies routines when duplicating an agent profile", () => {
    const a = makeAgent({ name: "Atlas" });
    store.createRoutine({
      agentId: a.id,
      name: "Morning scan",
      prompt: "Check inbox",
      intervalMinutes: 60,
    });
    const copy = store.createAgent({
      name: "Atlas copy",
      roleTitle: a.roleTitle,
      instructions: a.instructions,
      avatarColor: a.avatarColor,
      provider: a.provider,
      model: a.model,
      collaborationEnabled: true,
      stealthBrowsing: true,
    });
    store.copyAgentRoutines(a.id, copy.id);
    expect(store.listRoutines(copy.id).map((r) => r.name)).toEqual(["Morning scan"]);
    expect(store.listRoutines(copy.id)[0]?.prompt).toBe("Check inbox");
  });

  it("counts the official 50-item roster", () => {
    const a = makeAgent({ name: "One" });
    const b = makeAgent({ name: "Two" });
    store.createConversation("group", "Desk", [a.id, b.id]);
    expect(store.rosterCount()).toBe(3);
  });

  it("closes leftover in-flight work after a restart", () => {
    const agent = makeAgent({ name: "Orphan" });
    store.setAgentStatus(agent.id, "working");
    const conv = store.ensureDirectConversation(agent.id);
    const task = store.createTask(agent.id, conv.id, "research");
    store.updateTask(task.id, { status: "running" });
    store.createApproval({
      conversationId: conv.id,
      agentId: agent.id,
      taskId: task.id,
      actionJson: "{}",
      actionDescription: "send email",
      reason: "needs you",
    });
    const routine = store.createRoutine({
      agentId: agent.id,
      name: "Nightly",
      prompt: "Check logs",
      intervalMinutes: 60,
    });
    store.updateRoutine(routine.id, { lastStatus: "running" });

    const closed = store.closeOrphanedWork();
    expect(closed).toEqual({ tasks: 1, approvals: 1, routines: 1 });
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(store.listApprovalsByConversation(conv.id)[0]?.status).toBe("rejected");
    expect(store.getRoutine(routine.id)?.lastStatus).toBe("failed");

    store.setAgentStatus(agent.id, "working");
    const changes = store.reconcileAgentStatuses();
    expect(store.getAgent(agent.id)?.status).toBe("idle");
    expect(changes.map((c) => c.agentId)).toContain(agent.id);
  });

  it("persists plugins", () => {
    const plugin = store.createPlugin({
      name: "Status hook",
      kind: "webhook",
      url: "https://example.test/hook",
    });
    expect(store.listPlugins()).toHaveLength(1);
    expect(store.updatePlugin(plugin.id, { enabled: false })?.enabled).toBe(false);
    store.deletePlugin(plugin.id);
    expect(store.listPlugins()).toHaveLength(0);
  });
});
