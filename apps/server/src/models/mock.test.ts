import { describe, it, expect } from "vitest";
import { MockAdapter } from "./mock.js";
import type { AdapterInit } from "./types.js";

const init: AdapterInit = {
  model: "mock-scripted",
  systemPrompt: "test",
  resolution: { width: 1280, height: 800 },
  apiKey: "",
  collaborationEnabled: true,
};

describe("MockAdapter reporting", () => {
  it("queues send_message for say: and does not invent extra chat", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\nsay: Need you to take over for 2FA.", "");
    expect(d1).toMatchObject({ kind: "act", invocations: [{ tool: "send_message", text: "Need you to take over for 2FA." }] });
    const d2 = await a.next([{ id: "x", tool: "send_message", output: "sent" }]);
    expect(d2).toEqual({ kind: "final", text: "Done (mock run complete)." });
  });

  it("queues only sandbox work for run: (no chat tool)", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\nrun: ls ~/workspace", "");
    expect(d1.kind).toBe("act");
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]).toMatchObject({ tool: "bash", command: "ls ~/workspace" });
    expect(d1.assistantText).toBeUndefined();
  });

  it("ACKs a teammate FYI that needs no action — no chat report", async () => {
    const a = new MockAdapter(init);
    const d = await a.start(
      "New message from your teammate Milo (Coordinator):\nFYI I already saved the file.\n\nThis is a sandbox handoff.",
      "",
    );
    expect(d).toEqual({ kind: "final", text: "ACK" });
  });
});
