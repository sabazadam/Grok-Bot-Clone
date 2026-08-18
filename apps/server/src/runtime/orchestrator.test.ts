import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb } from "../db.js";
import { extractMentions, newTurnBudget, consumeTurn } from "./orchestrator.js";

beforeEach(() => {
  useTestDb();
});

describe("extractMentions", () => {
  const agents = [
    { id: "a1", name: "Nova" },
    { id: "a2", name: "Nova Prime" },
    { id: "a3", name: "Scout" },
  ];

  it("finds @mentions case-insensitively", () => {
    expect(extractMentions("hey @nova please check", agents)).toEqual(["a1"]);
    expect(extractMentions("@Scout and @Nova, split this up", agents)).toEqual(expect.arrayContaining(["a1", "a3"]));
  });

  it("prefers the longest matching name", () => {
    expect(extractMentions("@Nova Prime take over", agents)).toContain("a2");
  });

  it("returns empty when nobody is mentioned", () => {
    expect(extractMentions("just thinking out loud", agents)).toEqual([]);
  });

  it("does not match partial words", () => {
    expect(extractMentions("supernova@novafied", agents)).toEqual([]);
  });
});

describe("turn budget", () => {
  it("caps agent-to-agent turns per root message", () => {
    newTurnBudget("root1");
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      if (consumeTurn("root1")) allowed += 1;
    }
    expect(allowed).toBe(8); // config default MAX_AGENT_TURNS
  });

  it("allows a single turn for untracked roots (post-restart)", () => {
    expect(consumeTurn("unknown-root")).toBe(true);
  });
});
