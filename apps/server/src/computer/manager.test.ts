import { describe, it, expect } from "vitest";
import { agentIdFromNetworkName, networkNameFor, pickEvictionVictim } from "./manager.js";

describe("agent network names", () => {
  it("uses a dedicated prefix so networks are not confused with containers", () => {
    expect(networkNameFor("abc12")).toBe("agentos-net-abc12");
    expect(agentIdFromNetworkName("agentos-net-abc12")).toBe("abc12");
    expect(agentIdFromNetworkName("agentos-abc12")).toBeUndefined();
    expect(agentIdFromNetworkName("bridge")).toBeUndefined();
    expect(agentIdFromNetworkName("agentos-net-")).toBeUndefined();
  });
});

describe("pickEvictionVictim", () => {
  it("skips protected agents and picks the least recently used", () => {
    const lastUsed = new Map([
      ["busy", 100],
      ["old", 10],
      ["newer", 50],
    ]);
    expect(pickEvictionVictim(["busy", "old", "newer"], lastUsed, new Set(["busy"]))).toBe("old");
  });

  it("returns undefined when every running desktop is protected", () => {
    expect(pickEvictionVictim(["a", "b"], new Map(), new Set(["a", "b"]))).toBeUndefined();
  });
});
