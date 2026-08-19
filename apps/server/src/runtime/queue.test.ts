import { describe, it, expect } from "vitest";
import { clearPending, enqueue, enqueueAndWait } from "./queue.js";

describe("enqueueAndWait", () => {
  it("resolves waiters when pending jobs are dropped", async () => {
    enqueue("agent-a", async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    let droppedRan = false;
    const pending = enqueueAndWait("agent-a", async () => {
      droppedRan = true;
    });
    expect(clearPending("agent-a")).toBe(1);
    await pending;
    expect(droppedRan).toBe(false);
  });

  it("waits until the queued job finishes", async () => {
    let ran = false;
    await enqueueAndWait("agent-b", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
