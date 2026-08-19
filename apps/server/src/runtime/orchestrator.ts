/**
 * Orchestrator — decides which agents respond to a message and queues tasks.
 *
 * Direct chat: the agent in the conversation responds.
 * Group chat:  @mentioned agents; @everyone; otherwise team leads (or everyone
 * if the group has no lead). Skills (/Name) restrict to agents that have them.
 * A new user message interrupts that agent's current turn (Grok Bot priority).
 */
import type { Conversation, Message } from "@grokbot/shared";
import * as store from "../store.js";
import { config } from "../config.js";
import { broadcast } from "../bus.js";
import type { Attachment } from "@grokbot/shared";
import { enqueue, enqueueAndWait } from "./queue.js";
import { runAgentTask } from "./runner.js";
import { extractMentions } from "./dispatch.js";
import {
  chooseResponders,
  composeMentionContext,
  composeSkillPrompt,
  extractNamedMentions,
  extractSkillInvocation,
  isStopCommand,
} from "./dispatch.js";
import { interruptAgents } from "./interrupt.js";

const dispatchTokens = new Map<string, { cancelled: boolean }>();

export function cancelDispatch(conversationId: string): void {
  const token = dispatchTokens.get(conversationId);
  if (token) token.cancelled = true;
}

function attachmentPrompt(attachments?: Attachment[]): string {
  if (!attachments?.length) return "";
  const lines = attachments.map((a) => `- ${a.name} (${a.mime}, ${Math.round(a.size / 1024)} KB)`);
  return `The user attached files. Copies are in ~/workspace/inbox on your computer:\n${lines.join("\n")}`;
}

export { extractMentions } from "./dispatch.js";

/** taskId chain accounting: how many agent turns a root user message has caused */
const turnBudgets = new Map<string, { used: number }>();

export function newTurnBudget(rootId: string): void {
  turnBudgets.set(rootId, { used: 0 });
  if (turnBudgets.size > 200) {
    const first = turnBudgets.keys().next().value;
    if (first) turnBudgets.delete(first);
  }
}

export function consumeTurn(rootId: string): boolean {
  const b = turnBudgets.get(rootId);
  if (!b) return true;
  if (b.used >= config.maxAgentTurns) return false;
  b.used += 1;
  return true;
}

function postSystem(conversationId: string, text: string): void {
  const msg = store.addMessage({
    conversationId,
    sender: { kind: "system" },
    kind: "text",
    text,
  });
  broadcast({ type: "message", message: msg });
}

/** Dispatch a user message to the agents that should act on it. */
export function dispatchUserMessage(conversation: Conversation, message: Message): void {
  const members = conversation.agentIds
    .map((id) => store.getAgent(id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  if (members.length === 0) return;

  cancelDispatch(conversation.id);

  if (isStopCommand(message.text)) {
    interruptAgents(members.map((m) => m.id));
    postSystem(
      conversation.id,
      "Stopped. In-progress work was cancelled. Actions already completed are not undone.",
    );
    return;
  }

  const skills = store.listSkills();
  const invoked = extractSkillInvocation(message.text, skills);
  const skill = invoked ? store.getSkill(invoked.skillId) : undefined;
  const membersWithSkill = skill ? members.filter((m) => store.agentHasSkill(m.id, skill.id)).map((m) => m.id) : [];

  if (skill && conversation.kind === "direct" && membersWithSkill.length === 0) {
    postSystem(
      conversation.id,
      `Skill "${skill.name}" is not enabled for this agent. Enable it in Profile → Skills.`,
    );
    return;
  }

  const mentioned = extractMentions(message.text, members);
  const pluginMentions = extractNamedMentions(
    message.text,
    store
      .listPlugins()
      .filter((p) => p.enabled)
      .map((p) => p.name),
  );
  const routineMentions = extractNamedMentions(
    message.text,
    store.listRoutines().map((r) => r.name),
  );
  const attachedRoutines = store
    .listRoutines()
    .filter((r) => routineMentions.some((n) => n.toLowerCase() === r.name.toLowerCase()));
  const targetIds = chooseResponders({
    conversationKind: conversation.kind,
    members,
    text: message.text,
    mentionedIds: mentioned,
    skillId: skill?.id,
    membersWithSkill,
  });
  const targets = members.filter((m) => targetIds.includes(m.id));
  if (targets.length === 0) {
    if (skill) {
      postSystem(
        conversation.id,
        `No one in this chat has skill "${skill.name}" enabled.`,
      );
    }
    return;
  }

  // User message takes priority over whatever those agents were doing.
  interruptAgents(targets.map((t) => t.id));
  newTurnBudget(message.id);

  const token = { cancelled: false };
  dispatchTokens.set(conversation.id, token);

  const base = skill && invoked ? composeSkillPrompt(skill, invoked.rest) : message.text;
  const extras = [
    attachmentPrompt(message.attachments),
    composeMentionContext({ pluginNames: pluginMentions, routines: attachedRoutines }),
  ].filter(Boolean);
  const prompt = extras.length ? `${base}\n\n${extras.join("\n")}` : base;

  const start = (agentId: string) =>
    runAgentTask({
      agentId,
      conversationId: conversation.id,
      prompt,
      rootMessageId: message.id,
      triggeredBy: { kind: "user" },
      attachments: message.attachments,
    });

  if (targets.length <= 1) {
    for (const agent of targets) enqueue(agent.id, () => start(agent.id));
    return;
  }

  // Several teammates at once is noisy (they all boot computers). Official
  // Grok Bot stays quieter: run them one after another unless the user stops.
  void (async () => {
    for (const agent of targets) {
      if (token.cancelled) return;
      await enqueueAndWait(agent.id, () => start(agent.id));
    }
  })();
}

/**
 * Deliver an agent-to-agent message into a view-only hierarchical thread
 * (not a sidebar chat). The recipient is woken on that thread. Markers in
 * each agent's user chat let you open the thread from either workspace.
 */
export function deliverAgentMessage(opts: {
  fromAgentId: string;
  toAgentId: string;
  text: string;
  rootMessageId: string;
}): { delivered: boolean; conversationId?: string } {
  if (!consumeTurn(opts.rootMessageId)) return { delivered: false };
  const from = store.getAgent(opts.fromAgentId);
  const to = store.getAgent(opts.toAgentId);
  const dm = store.ensureAgentDm(opts.fromAgentId, opts.toAgentId);
  const msg = store.addMessage({
    conversationId: dm.id,
    sender: { kind: "agent", agentId: opts.fromAgentId },
    kind: "text",
    text: opts.text,
  });
  broadcast({ type: "message", message: msg });
  const updated = store.getConversation(dm.id);
  if (updated) broadcast({ type: "conversation_updated", conversation: updated });

  const recipientDirect = store.ensureDirectConversation(opts.toAgentId);
  const inbound = store.addMessage({
    conversationId: recipientDirect.id,
    sender: { kind: "agent", agentId: opts.fromAgentId },
    kind: "text",
    text: `From ${from?.name ?? "teammate"}`,
    relatedConversationId: dm.id,
  });
  broadcast({ type: "message", message: inbound });
  const inboundConv = store.getConversation(recipientDirect.id);
  if (inboundConv) broadcast({ type: "conversation_updated", conversation: inboundConv });

  enqueue(opts.toAgentId, () =>
    runAgentTask({
      agentId: opts.toAgentId,
      conversationId: dm.id,
      prompt: opts.text,
      rootMessageId: opts.rootMessageId,
      triggeredBy: { kind: "agent", agentId: opts.fromAgentId },
    }),
  );
  return { delivered: true, conversationId: dm.id };
}

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

/** Stop every agent in a conversation (Stop button / API). */
export function stopConversation(conversationId: string): boolean {
  const conv = store.getConversation(conversationId);
  if (!conv) return false;
  cancelDispatch(conversationId);
  interruptAgents(conv.agentIds);
  postSystem(
    conversationId,
    "Stopped. In-progress work was cancelled. Actions already completed are not undone.",
  );
  return true;
}
