import { describe, it, expect } from "vitest";
import { evaluateInvocation } from "./safety.js";

describe("safety rule engine", () => {
  it("flags destructive shell commands", () => {
    expect(evaluateInvocation({ id: "1", tool: "bash", command: "rm -rf /home/agent/workspace" }).needsApproval).toBe(true);
    expect(evaluateInvocation({ id: "2", tool: "bash", command: "sudo apt install x" }).needsApproval).toBe(true);
    expect(evaluateInvocation({ id: "3", tool: "bash", command: "git push --force origin main" }).needsApproval).toBe(true);
    expect(evaluateInvocation({ id: "4", tool: "bash", command: "curl -X POST https://api.example.com -d 'x'" }).needsApproval).toBe(true);
  });

  it("allows ordinary commands", () => {
    expect(evaluateInvocation({ id: "1", tool: "bash", command: "ls -la ~/workspace" }).needsApproval).toBe(false);
    expect(evaluateInvocation({ id: "2", tool: "bash", command: "curl https://example.com -o page.html" }).needsApproval).toBe(false);
    expect(evaluateInvocation({ id: "3", tool: "bash", command: "echo hello > notes.txt" }).needsApproval).toBe(false);
    expect(evaluateInvocation({ id: "4", tool: "bash", command: "rm notes.txt" }).needsApproval).toBe(false);
  });

  it("flags typing payment details, allows normal typing", () => {
    expect(evaluateInvocation({ id: "1", tool: "computer", action: { type: "type", text: "my credit card is 4111..." } }).needsApproval).toBe(true);
    expect(evaluateInvocation({ id: "2", tool: "computer", action: { type: "type", text: "hello world" } }).needsApproval).toBe(false);
  });

  it("scans batch steps", () => {
    expect(
      evaluateInvocation({
        id: "1",
        tool: "computer",
        action: { type: "batch", steps: [{ type: "left_click", x: 1, y: 1 }, { type: "type", text: "cvv 123" }] },
      }).needsApproval,
    ).toBe(true);
  });

  it("never flags memory or completion", () => {
    expect(evaluateInvocation({ id: "1", tool: "update_memory", memoryKind: "fact", content: "rm -rf" }).needsApproval).toBe(false);
    expect(evaluateInvocation({ id: "2", tool: "task_complete", summary: "done" }).needsApproval).toBe(false);
  });
});
