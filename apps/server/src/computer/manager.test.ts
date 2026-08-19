import { describe, it, expect } from "vitest";
import { pickEvictionVictim } from "./manager.js";

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
