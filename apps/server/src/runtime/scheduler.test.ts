import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { runRoutineNow, tickRoutines } from "./scheduler.js";

beforeEach(() => {
  useTestDb();
});

function makeAgent() {
  return store.createAgent({
    name: "Piper",
    roleTitle: "Ops",
    instructions: "",
    avatarColor: "#111111",
    provider: "generic",
    model: "mock-scripted",
    collaborationEnabled: true,
    stealthBrowsing: true,
  });
}

describe("scheduler overlap guard", () => {
  it("skips a scheduled tick while a run is already in flight", () => {
    const agent = makeAgent();
    const routine = store.createRoutine({
      agentId: agent.id,
      name: "Watch",
      prompt: "Look around",
      intervalMinutes: 1,
    });
    store.markRoutineRan(routine.id, "running");
    expect(runRoutineNow(routine.id)).toBe(false);
    expect(tickRoutines(Date.now() + 5 * 60_000)).toBe(0);
  });
});
