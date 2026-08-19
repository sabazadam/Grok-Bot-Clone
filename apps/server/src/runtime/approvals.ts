/**
 * Approval gate plumbing: a running task creates a pending approval and awaits
 * the user's decision; the REST route resolves it and wakes the task.
 */
import type { Approval } from "@grokbot/shared";
import * as store from "../store.js";
import { broadcast } from "../bus.js";

const waiters = new Map<string, (decision: "approved" | "rejected") => void>();

/** Called from the task loop. Blocks until the user decides (or timeout). */
export async function requestApproval(input: {
  taskId: string;
  agentId: string;
  conversationId: string;
  actionDescription: string;
  actionJson: string;
  reason: string;
  timeoutMs?: number;
}): Promise<"approved" | "rejected" | "timeout"> {
  const approval = store.createApproval(input);
  const agent = store.getAgent(input.agentId);

  const message = store.addMessage({
    conversationId: input.conversationId,
    sender: { kind: "agent", agentId: input.agentId },
    kind: "approval_request",
    text: `${agent?.name ?? "Agent"} wants to: ${input.actionDescription}\n\nReason: ${input.reason}`,
    approvalId: approval.id,
  });
  broadcast({ type: "message", message });
  broadcast({ type: "approval_created", approval });

  return new Promise((resolve) => {
    const timer = setTimeout(
      () => {
        waiters.delete(approval.id);
        store.resolveApproval(approval.id, "rejected");
        resolve("timeout");
      },
      input.timeoutMs ?? 15 * 60 * 1000,
    );
    waiters.set(approval.id, (decision) => {
      clearTimeout(timer);
      waiters.delete(approval.id);
      resolve(decision);
    });
  });
}

/** Reject every open approval for these agents (used when the user says Stop now). */
export function rejectOpenApprovalsForAgents(agentIds: string[]): void {
  for (const id of agentIds) {
    for (const a of store.listPendingApprovalsForAgent(id)) {
      resolvePendingApproval(a.id, "rejected");
    }
  }
}

/** Called from the REST route. */
export function resolvePendingApproval(id: string, decision: "approved" | "rejected"): Approval | undefined {
  const existing = store.getApproval(id);
  if (!existing || existing.status !== "pending") return undefined;
  const approval = store.resolveApproval(id, decision);
  if (approval) {
    broadcast({ type: "approval_resolved", approval });
    waiters.get(id)?.(decision);
  }
  return approval;
}
