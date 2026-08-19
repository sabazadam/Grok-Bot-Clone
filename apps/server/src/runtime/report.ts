/**
 * Grok Bot reporting policy.
 *
 * Official Grok Bot: teammates finish jobs end-to-end on their computer and
 * only come back when something needs you — a result, a blocker, or approval.
 * Clicks, keystrokes, and shell work stay on the sandbox screen (Agent Computer).
 *
 * This clone previously posted every model thought and every computer action
 * into the conversation. That is the opposite of the product: noisy, and it
 * trains models to narrate sandbox work instead of doing it.
 */
import type { ToolInvocation } from "../models/types.js";

/** Work that belongs on the agent's computer, not in chat. */
export function isSandboxWork(inv: ToolInvocation): boolean {
  return inv.tool === "computer" || inv.tool === "bash" || inv.tool === "update_memory";
}

/**
 * Final replies that must not be posted. ACK is the explicit "no reply needed"
 * convention used for teammate handoffs that required no user-visible update.
 */
export function isSilentReply(text: string): boolean {
  return /^(ack[.!]?)?$/i.test(text.trim());
}

/** Model narration ("I'll click the search box") is never a chat message. */
export function shouldPostAssistantNarration(_text?: string): boolean {
  return false;
}

/**
 * Whether a tool invocation should persist a chat message.
 * Sandbox actions: no. Explicit communication: yes.
 */
export function shouldPostToolToChat(inv: ToolInvocation): boolean {
  switch (inv.tool) {
    case "send_message":
    case "send_message_to_agent":
    case "create_agent":
    case "create_routine":
    case "save_skill":
      return true;
    case "computer":
    case "bash":
    case "update_memory":
    case "request_approval":
    case "task_complete":
      return false;
  }
}

/** Caption shown in the sender's chat when they hand work to a teammate. */
export function handoffCaption(toAgentName: string, _text?: string): string {
  return `Messaged ${toAgentName}`;
}

/** User-visible caption for an explicit communication / team-structure tool. */
export function communicationCaption(inv: ToolInvocation): string | undefined {
  switch (inv.tool) {
    case "send_message_to_agent":
      return handoffCaption(inv.toAgentName, inv.text);
    case "save_skill":
      return `Saved skill “${inv.name}”. Type /${inv.name} to run it.`;
    case "create_agent":
      return `Created teammate @${inv.name}${inv.roleTitle ? ` (${inv.roleTitle})` : ""}.`;
    case "create_routine":
      return `Scheduled “${inv.name}”${inv.schedule ? ` (${inv.schedule})` : ""}.`;
    default:
      return undefined;
  }
}
