import { describe, it, expect } from "vitest";
import { assertNotAborted, cancelTask, registerTask, unregisterTask } from "./cancel.js";

describe("assertNotAborted", () => {
  it("is a no-op while the task is still running", () => {
    const signal = registerTask("t1", "a1");
    expect(() => assertNotAborted(signal)).not.toThrow();
    unregisterTask("t1");
  });

  it("throws AbortError as soon as Stop cancels the task", () => {
    const signal = registerTask("t2", "a1");
    cancelTask("t2");
    expect(signal.aborted).toBe(true);
    try {
      assertNotAborted(signal);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).name).toBe("AbortError");
    }
    unregisterTask("t2");
  });
});
