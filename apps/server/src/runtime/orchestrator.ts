/**
 * Orchestrator — decides which agents respond to a message and queues tasks.
 *
 * Direct chat: the agent in the conversation responds.
 * Group chat:  @mentioned agents respond; with no mention, all member agents do.
 * Agent-to-agent turns triggered by one user message are capped (loop prevention).
 */
import type { Conversation, Message } from "@grokbot/shared";
import * as store from "../store.js";
import { config } from "../config.js";
import { broadcast } from "../bus.js";
import { enqueue } from "./queue.js";
import { runAgentTask } from "./runner.js";

/** taskId chain accounting: how many agent turns a root user message has caused */
const turnBudgets = new Map<string, { used: number }>();

export function newTurnBudget(rootId: string): void {
  turnBudgets.set(rootId, { used: 0 });
  // prevent unbounded growth
  if (turnBudgets.size > 200) {
    const first = turnBudgets.keys().next().value;
    if (first) turnBudgets.delete(first);
  }
}

export function consumeTurn(rootId: string): boolean {
  const b = turnBudgets.get(rootId);
  if (!b) return true; // untracked (e.g. server restart) — allow single turn
  if (b.used >= config.maxAgentTurns) return false;
  b.used += 1;
  return true;
}

/** Extract @mentions matching known agent names (case-insensitive, longest first). */
export function extractMentions(text: string, agents: { id: string; name: string }[]): string[] {
  const found: string[] = [];
  const sorted = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const a of sorted) {
    const re = new RegExp(`@${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) found.push(a.id);
  }
  return found;
}

/** Dispatch a user message to the agents that should act on it. */
export function dispatchUserMessage(conversation: Conversation, message: Message): void {
  const members = conversation.agentIds
    .map((id) => store.getAgent(id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  if (members.length === 0) return;

  newTurnBudget(message.id);

  let targets = members;
  if (conversation.kind === "group") {
    const mentioned = extractMentions(message.text, members);
    if (mentioned.length > 0) {
      targets = members.filter((m) => mentioned.includes(m.id));
    }
  }

  for (const agent of targets) {
    enqueue(agent.id, () =>
      runAgentTask({
        agentId: agent.id,
        conversationId: conversation.id,
        prompt: message.text,
        rootMessageId: message.id,
        triggeredBy: { kind: "user" },
      }),
    );
  }
}

/**
 * Deliver an agent-to-agent message into the RECIPIENT'S OWN chat (their direct
 * conversation), then wake them to act on it there. This keeps delegation visible
 * in the target agent's chat instead of spawning separate "agent ↔ agent" threads
 * that would clutter the sidebar. Budget-capped for loop prevention.
 */
export function deliverAgentMessage(opts: {
  fromAgentId: string;
  toAgentId: string;
  text: string;
  rootMessageId: string;
}): { delivered: boolean; conversationId?: string } {
  if (!consumeTurn(opts.rootMessageId)) return { delivered: false };
  const conv = store.ensureDirectConversation(opts.toAgentId);
  const msg = store.addMessage({
    conversationId: conv.id,
    sender: { kind: "agent", agentId: opts.fromAgentId },
    kind: "text",
    text: opts.text,
  });
  broadcast({ type: "message", message: msg });
  const updated = store.getConversation(conv.id);
  if (updated) broadcast({ type: "conversation_updated", conversation: updated });
  enqueue(opts.toAgentId, () =>
    runAgentTask({
      agentId: opts.toAgentId,
      conversationId: conv.id,
      prompt: opts.text,
      rootMessageId: opts.rootMessageId,
      triggeredBy: { kind: "agent", agentId: opts.fromAgentId },
    }),
  );
  return { delivered: true, conversationId: conv.id };
}

/**
 * Wake an agent to act within an EXISTING conversation (used for group-chat
 * handoffs, where the message is already posted in the group). Enqueue-only.
 */
export function dispatchAgentMessage(opts: {
  fromAgentId: string;
  toAgentId: string;
  conversationId: string;
  text: string;
  rootMessageId: string;
}): boolean {
  if (!consumeTurn(opts.rootMessageId)) return false;
  enqueue(opts.toAgentId, () =>
    runAgentTask({
      agentId: opts.toAgentId,
      conversationId: opts.conversationId,
      prompt: opts.text,
      rootMessageId: opts.rootMessageId,
      triggeredBy: { kind: "agent", agentId: opts.fromAgentId },
    }),
  );
  return true;
}
