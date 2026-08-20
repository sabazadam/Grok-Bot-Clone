import { describe, it, expect, beforeEach } from "vitest";
import {
  TAKEOVER_MAX_MS,
  clearAllTakeovers,
  expireStaleTakeovers,
  isTakenOver,
  listTakeovers,
  setTakeover,
} from "./takeover.js";

beforeEach(() => {
  clearAllTakeovers();
});

describe("takeover", () => {
  it("tracks an active session and clears it", () => {
    setTakeover("agent-a", true);
    expect(isTakenOver("agent-a")).toBe(true);
    expect(listTakeovers()).toEqual(["agent-a"]);
    setTakeover("agent-a", false);
    expect(isTakenOver("agent-a")).toBe(false);
    expect(listTakeovers()).toEqual([]);
  });

  it("expires a session that outlived the timeout", () => {
    setTakeover("agent-a", true);
    expect(expireStaleTakeovers(Date.now() + TAKEOVER_MAX_MS + 1)).toEqual(["agent-a"]);
    expect(isTakenOver("agent-a")).toBe(false);
  });

  it("clears every leftover session at once", () => {
    setTakeover("a", true);
    setTakeover("b", true);
    expect(clearAllTakeovers().sort()).toEqual(["a", "b"]);
    expect(listTakeovers()).toEqual([]);
  });
});
