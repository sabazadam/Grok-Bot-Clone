import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { cancelTask, hasLiveTask, registerTask, unregisterTask } from "./cancel.js";
import { interruptAgents } from "./interrupt.js";

beforeEach(() => {
  useTestDb();
});

function makeAgent(name: string) {
  return store.createAgent({
    name,
    roleTitle: "Bot",
    instructions: "",
    avatarColor: "#111111",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    collaborationEnabled: true,
    stealthBrowsing: true,
  });
}

describe("cancelTask", () => {
  it("aborts a live runner without rewriting the store row", () => {
    const agent = makeAgent("Live");
    const conv = store.ensureDirectConversation(agent.id);
    const task = store.createTask(agent.id, conv.id, "go");
    store.updateTask(task.id, { status: "running" });
    const signal = registerTask(task.id, agent.id);
    expect(cancelTask(task.id)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(store.getTask(task.id)?.status).toBe("running");
    expect(hasLiveTask(agent.id)).toBe(true);
    unregisterTask(task.id);
  });

  it("persist-cancels leftover SQLite tasks after a restart", () => {
    const agent = makeAgent("Ghost");
    const conv = store.ensureDirectConversation(agent.id);
    const task = store.createTask(agent.id, conv.id, "go");
    store.updateTask(task.id, { status: "running" });
    expect(hasLiveTask(agent.id)).toBe(false);
    expect(cancelTask(task.id)).toBe(true);
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(cancelTask(task.id)).toBe(false);
  });
});

describe("interruptAgents", () => {
  it("clears ghost working status when no runner is alive", () => {
    const agent = makeAgent("Stuck");
    store.setAgentStatus(agent.id, "working");
    const conv = store.ensureDirectConversation(agent.id);
    const task = store.createTask(agent.id, conv.id, "go");
    store.updateTask(task.id, { status: "running" });

    interruptAgents([agent.id]);

    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(store.getAgent(agent.id)?.status).toBe("idle");
  });

  it("does not clobber starting while a computer is still booting", () => {
    const agent = makeAgent("Booting");
    store.setAgentStatus(agent.id, "starting");
    interruptAgents([agent.id]);
    expect(store.getAgent(agent.id)?.status).toBe("starting");
  });
});
