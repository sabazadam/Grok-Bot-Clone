/**
 * Integration test for ComputerManager against a real Docker daemon.
 * Gated: RUN_DOCKER_TESTS=1 npm run test:integration -w apps/server
 * Requires the grokbot/agent-desktop image (npm run image:build).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ComputerManager } from "./manager.js";

const enabled = process.env.RUN_DOCKER_TESTS === "1";
const d = enabled ? describe : describe.skip;

const TEST_AGENT = "itest0001";

d("ComputerManager (docker integration)", () => {
  const mgr = new ComputerManager();

  beforeAll(async () => {
    expect(await mgr.dockerAvailable()).toBe(true);
    expect(await mgr.imageAvailable()).toBe(true);
    await mgr.destroy(TEST_AGENT, true).catch(() => undefined);
  });

  afterAll(async () => {
    await mgr.destroy(TEST_AGENT, true).catch(() => undefined);
  });

  it("boots an agent computer and reports running status", async () => {
    const info = await mgr.ensureRunning(TEST_AGENT);
    expect(info.state).toBe("running");
    expect(info.novncPort).toBeGreaterThan(0);
    expect(info.actuatorPort).toBeGreaterThan(0);
  });

  it("takes a valid PNG screenshot at the configured resolution", async () => {
    const png = await mgr.screenshot(TEST_AGENT);
    // PNG magic bytes
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(1000);
  });

  it("executes shell commands as the non-root agent user", async () => {
    const r = await mgr.exec(TEST_AGENT, "whoami && pwd");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("agent");
    expect(r.output).toContain("/home/agent");
  });

  it("operates the GUI: opens xterm, types a command via keyboard, file appears", async () => {
    const launch = await mgr.exec(
      TEST_AGENT,
      "DISPLAY=:0 nohup xterm > /dev/null 2>&1 & sleep 2; DISPLAY=:0 xdotool search --sync --class xterm windowactivate; sleep 1; echo launched",
      30,
    );
    expect(launch.ok).toBe(true);

    const typed = await mgr.act(TEST_AGENT, { type: "type", text: "echo hello-from-gui > /home/agent/workspace/gui.txt\n" });
    expect(typed.ok).toBe(true);

    // give the shell a moment
    await new Promise((r) => setTimeout(r, 1500));
    const check = await mgr.exec(TEST_AGENT, "cat /home/agent/workspace/gui.txt");
    expect(check.ok).toBe(true);
    expect(check.output).toContain("hello-from-gui");
  });

  it("supports mouse actions and cursor position", async () => {
    const move = await mgr.act(TEST_AGENT, { type: "mouse_move", x: 100, y: 200 });
    expect(move.ok).toBe(true);
    const pos = await mgr.act(TEST_AGENT, { type: "cursor_position" });
    expect(pos.ok).toBe(true);
    expect(pos.cursor).toEqual({ x: 100, y: 200 });
  });

  it("persists files across a computer restart (named volume)", async () => {
    await mgr.exec(TEST_AGENT, "echo persistent > /home/agent/workspace/keep.txt");
    await mgr.stop(TEST_AGENT);
    await mgr.ensureRunning(TEST_AGENT);
    const r = await mgr.exec(TEST_AGENT, "cat /home/agent/workspace/keep.txt");
    expect(r.output).toContain("persistent");
  });
});
