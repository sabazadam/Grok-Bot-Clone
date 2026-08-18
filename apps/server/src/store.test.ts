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
