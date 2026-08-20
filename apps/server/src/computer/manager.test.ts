import { describe, it, expect } from "vitest";
import { pickEvictionVictim, waitForHealth } from "./manager.js";

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

describe("waitForHealth", () => {
  it("throws immediately when Stop already fired", async () => {
    const c = new AbortController();
    c.abort();
    let fetches = 0;
    await expect(
      waitForHealth("http://127.0.0.1:9/health", "http://127.0.0.1:9/screenshot", 90_000, c.signal, async () => {
        fetches += 1;
        return new Response("ok");
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetches).toBe(0);
  });

  it("aborts a hanging health probe instead of waiting out the boot timeout", async () => {
    const c = new AbortController();
    const started = Date.now();
    const hung = waitForHealth(
      "http://127.0.0.1:9/health",
      "http://127.0.0.1:9/screenshot",
      90_000,
      c.signal,
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    setTimeout(() => c.abort(), 20);
    await expect(hung).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("returns once health and screenshot both succeed", async () => {
    await expect(
      waitForHealth("http://health", "http://shot", 5_000, undefined, async () => new Response("ok")),
    ).resolves.toBeUndefined();
  });
});
