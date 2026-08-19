/**
 * Approval rule engine — host-side checks that run on EVERY tool invocation,
 * independent of what the model thinks. Modeled on Grok Bot's approval boundary
 * ("sending, purchasing, deleting, publishing, or changing production systems").
 */
import type { ToolInvocation } from "../models/types.js";

export interface SafetyVerdict {
  needsApproval: boolean;
  reason?: string;
}

/** Destructive / consequential shell patterns. */
const RISKY_COMMAND_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r)\b/, label: "recursive force-delete (rm -rf)" },
  { re: /\brm\s+.*(\/home\/agent\/workspace|\s~\/workspace)/, label: "deleting workspace files" },
  { re: /\bmkfs\b|\bdd\s+if=/, label: "disk-level operation" },
  { re: /\bshutdown\b|\breboot\b/, label: "shutting down the computer" },
  { re: /\bgit\s+push\b.*(--force|-f)\b/, label: "git force-push" },
  { re: /\bcurl\b[^|;&]*(-X\s*(POST|PUT|DELETE)|--data|-d\s)/i, label: "sending data to an external service" },
  { re: /\bwget\b[^|;&]*--post/i, label: "sending data to an external service" },
  { re: /\bmail\b|\bsendmail\b|\bmutt\b/, label: "sending email" },
  { re: /\bsudo\b/, label: "privilege escalation" },
];

/** Text an agent is about to type that suggests a consequential submission. */
const RISKY_TYPED_HINTS: { re: RegExp; label: string }[] = [
  { re: /\b(credit\s*card|cvv|iban)\b/i, label: "entering payment details" },
];

export function evaluateInvocation(inv: ToolInvocation): SafetyVerdict {
  if (inv.tool === "bash") {
    for (const { re, label } of RISKY_COMMAND_PATTERNS) {
      if (re.test(inv.command)) {
        return { needsApproval: true, reason: `Shell command looks consequential: ${label}` };
      }
    }
    return { needsApproval: false };
  }
  if (inv.tool === "computer") {
    if (inv.action.type === "type") {
      for (const { re, label } of RISKY_TYPED_HINTS) {
        if (re.test(inv.action.text)) {
          return { needsApproval: true, reason: label };
        }
      }
    }
    if (inv.action.type === "batch") {
      for (const step of inv.action.steps) {
        if (step.type === "type") {
          for (const { re, label } of RISKY_TYPED_HINTS) {
            if (re.test(step.text)) {
              return { needsApproval: true, reason: label };
            }
          }
        }
      }
    }
    return { needsApproval: false };
  }
  // request_approval is itself the approval path; memory/messaging/complete are safe
  return { needsApproval: false };
}

/** Compact human-readable description of the exact pending action (for the approval card). */
export function describeExactAction(inv: ToolInvocation): string {
  switch (inv.tool) {
    case "bash":
      return `Run shell command:\n$ ${inv.command}`;
    case "computer":
      return `Computer action: ${JSON.stringify(inv.action)}`;
    case "save_skill":
      return `Save skill “${inv.name}”`;
    case "create_agent":
      return `Create teammate ${inv.name}`;
    case "create_routine":
      return `Schedule “${inv.name}”${inv.schedule ? ` (${inv.schedule})` : inv.intervalMinutes ? ` every ${inv.intervalMinutes}m` : ""}`;
    case "send_message":
      return `Message the conversation: "${inv.text}"`;
    case "send_image":
      return inv.path ? `Send image ${inv.path} to the chat` : "Send a screenshot to the chat";
    case "send_message_to_agent":
      return `Message @${inv.toAgentName}: "${inv.text}"`;
    case "request_approval":
      return inv.description;
    case "update_memory":
      return `Save to memory: ${inv.content}`;
    case "task_complete":
      return `Finish task: ${inv.summary}`;
    case "call_plugin":
      return `Call plugin ${inv.pluginId}.${inv.toolName}`;
    case "delegate_task":
      return `Delegate ${inv.tasks.length} task(s) to ${inv.tasks.map((t) => t.agentName || t.spawn?.name).filter(Boolean).join(", ") || "specialists"}`;
  }
}
