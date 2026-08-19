import { describe, it, expect } from "vitest";
import { MockAdapter } from "./mock.js";
import type { AdapterInit } from "./types.js";

const init: AdapterInit = {
  model: "mock-scripted",
  systemPrompt: "test",
  resolution: { width: 1280, height: 800 },
  apiKey: "",
  collaborationEnabled: true,
  allowedTools: [],
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

  it("queues save_skill / create_agent / create_routine directives", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\nsave skill Weekly account health: Pull CRM. Do not contact.", "");
    expect(d1).toMatchObject({
      kind: "act",
      invocations: [{ tool: "save_skill", name: "Weekly account health" }],
    });
  });

  it("opens Google for a natural search prompt", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\nopen google and search what is izmir weather today", "");
    expect(d1.kind).toBe("act");
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]?.tool).toBe("bash");
    expect(String((d1.invocations[0] as { command?: string }).command)).toMatch(/google\.com\/search/);
  });

  it("parses 'delegate to' into a delegate_task for an existing teammate", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\ndelegate to Researcher: dig into the competitors", "");
    expect(d1.kind).toBe("act");
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]).toMatchObject({
      tool: "delegate_task",
      tasks: [{ agentName: "Researcher", goal: "dig into the competitors" }],
    });
  });

  it("parses 'spawn X as Role' into a delegate_task that spawns a specialist", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\nspawn Scout as Researcher: find primary sources", "");
    if (d1.kind !== "act") throw new Error();
    expect(d1.invocations[0]).toMatchObject({
      tool: "delegate_task",
      tasks: [{ spawn: { name: "Scout", roleTitle: "Researcher" }, goal: "find primary sources" }],
    });
  });

  it("parses 'delegate parallel' into a concurrent batch", async () => {
    const a = new MockAdapter(init);
    const d1 = await a.start("New message from the user:\ndelegate parallel: Researcher=dig X; Coder=build Y", "");
    if (d1.kind !== "act") throw new Error();
    const inv = d1.invocations[0]!;
    if (inv.tool !== "delegate_task") throw new Error("expected delegate_task");
    expect(inv.tasks).toHaveLength(2);
    expect(inv.tasks[0]).toMatchObject({ agentName: "Researcher", goal: "dig X" });
    expect(inv.tasks[1]).toMatchObject({ agentName: "Coder", goal: "build Y" });
    expect(inv.concurrency).toBe(2);
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
