/**
 * Agent task runner. Phase 2: minimal acknowledgment stub.
 * Phase 3 replaces the body with the real multi-model computer-use loop.
 */
import * as store from "../store.js";
import { broadcast } from "../bus.js";
import * as service from "../agents/service.js";
import { computerManager } from "../computer/manager.js";

export interface RunTaskOptions {
  agentId: string;
  conversationId: string;
  prompt: string;
  rootMessageId: string;
  triggeredBy: { kind: "user" } | { kind: "agent"; agentId: string };
}

export async function runAgentTask(opts: RunTaskOptions): Promise<void> {
  const agent = store.getAgent(opts.agentId);
  const conversation = store.getConversation(opts.conversationId);
  if (!agent || !conversation) return;

  const task = store.createTask(agent.id, conversation.id, opts.prompt);
  service.setStatus(agent.id, "working");
  broadcast({ type: "task_updated", task });

  try {
    await computerManager.ensureRunning(agent.id);
    // ── Phase 2 stub: acknowledge; real model loop lands in Phase 3 ──
    const reply = store.addMessage({
      conversationId: conversation.id,
      sender: { kind: "agent", agentId: agent.id },
      kind: "text",
      text: `(${agent.name} · ${agent.roleTitle || "agent"}) My computer is up and I received: "${opts.prompt}". Model loop coming in Phase 3.`,
    });
    broadcast({ type: "message", message: reply });
    store.updateTask(task.id, { status: "done", finishedAt: Date.now() });
  } catch (err) {
    const msg = store.addMessage({
      conversationId: conversation.id,
      sender: { kind: "system" },
      kind: "error",
      text: `${agent.name} failed: ${(err as Error).message}`,
    });
    broadcast({ type: "message", message: msg });
    store.updateTask(task.id, { status: "failed", finishedAt: Date.now() });
  } finally {
    const t = store.getTask(task.id);
    if (t) broadcast({ type: "task_updated", task: t });
    service.setStatus(agent.id, "idle");
  }
}
