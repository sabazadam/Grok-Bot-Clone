import { describe, it, expect, vi } from "vitest";
import { pickEvictionVictim, ComputerManager } from "./manager.js";
import type { ComputerBackend } from "./backend.js";

describe("ComputerBackend interface", () => {
  it("is satisfied by the Docker-backed ComputerManager", () => {
    // Compile-time conformance is enforced by `implements ComputerBackend`; assert at runtime too so
    // a future host backend can be swapped in behind the same seam.
    const backend: ComputerBackend = new ComputerManager();
    for (const m of ["ensureRunning", "status", "screenshot", "act", "exec", "stop", "destroy", "syncBrowserConfig", "stopIdle"]) {
      expect(typeof (backend as unknown as Record<string, unknown>)[m]).toBe("function");
    }
  });
});

describe("syncBrowserConfig", () => {
  it("writes STEALTH/ENGINE/CAMOU_CONFIG into the in-container browser.env", async () => {
    const mgr = new ComputerManager();
    const exec = vi.spyOn(mgr, "exec").mockResolvedValue({ ok: true, exitCode: 0, output: "" });
    await mgr.syncBrowserConfig("a1", {
      stealth: true,
      engine: "camoufox",
      userAgent: "UA/1.0",
      timezone: "Europe/Berlin",
      locale: "de-DE",
      camouConfig: '{"timezone":"Europe/Berlin"}',
    });
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0]![1] as string;
    expect(cmd).toContain("STEALTH=1");
    expect(cmd).toContain("ENGINE='camoufox'");
    expect(cmd).toContain("USER_AGENT='UA/1.0'");
    expect(cmd).toContain("TZ='Europe/Berlin'");
    expect(cmd).toContain("CAMOU_CONFIG='{\"timezone\":\"Europe/Berlin\"}'");
  });

  it("defaults engine to chromium with empty camou config", async () => {
    const mgr = new ComputerManager();
    const exec = vi.spyOn(mgr, "exec").mockResolvedValue({ ok: true, exitCode: 0, output: "" });
    await mgr.syncBrowserConfig("a2", { stealth: false, userAgent: "", timezone: "", locale: "en-US" });
    const cmd = exec.mock.calls[0]![1] as string;
    expect(cmd).toContain("STEALTH=0");
    expect(cmd).toContain("ENGINE='chromium'");
    expect(cmd).toContain("CAMOU_CONFIG=''");
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
