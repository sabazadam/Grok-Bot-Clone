/**
 * Custom (non-computer) tool definitions shared by all provider adapters,
 * in neutral JSON-schema form. Each adapter converts to its provider's format.
 */

export interface NeutralTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  required: string[];
}

export function customTools(collaborationEnabled: boolean): NeutralTool[] {
  const tools: NeutralTool[] = [
    {
      name: "bash",
      description:
        "Run a shell command on YOUR computer (as user 'agent', cwd /home/agent). Prefer this over the GUI for file operations, downloads, and scripts. GUI apps can be launched with e.g. `DISPLAY=:0 nohup <app> & `.",
      parameters: {
        command: { type: "string", description: "The bash command to run" },
        timeoutSec: { type: "number", description: "Timeout in seconds (default 60, max 600)" },
      },
      required: ["command"],
    },
    {
      name: "update_memory",
      description:
        "Save a durable note to your long-term memory so future tasks benefit. Use for stable preferences, important facts, and lessons learned. Keep each entry short.",
      parameters: {
        kind: { type: "string", enum: ["preference", "fact", "summary"] },
        content: { type: "string", description: "The note to remember" },
      },
      required: ["kind", "content"],
    },
    {
      name: "request_approval",
      description:
        "Pause and ask the user for explicit approval before a consequential or irreversible action (sending messages/emails, purchasing, deleting data, publishing, submitting forms on someone's behalf). Wait for the decision.",
      parameters: {
        description: { type: "string", description: "Exactly what you want to do, concretely" },
        reason: { type: "string", description: "Why this action is needed for the task" },
      },
      required: ["description", "reason"],
    },
    {
      name: "send_message",
      description:
        "Post a message in this conversation. Use ONLY when the user needs to know something now: a blocker, a question only they can answer, a takeover request, or a milestone they asked to be told about. Do NOT narrate clicks, commands, screenshots, or routine sandbox work.",
      parameters: {
        text: { type: "string", description: "Concise, task-related message" },
      },
      required: ["text"],
    },
    {
      name: "task_complete",
      description:
        "Call when the task is fully finished. The summary is your one reply to the requester — outcome and where artifacts live. If no reply is needed, use exactly ACK so nothing is posted.",
      parameters: {
        summary: { type: "string", description: "Final reply describing the outcome, or ACK if no reply is needed" },
      },
      required: ["summary"],
    },
  ];
  if (collaborationEnabled) {
    tools.push({
      name: "send_message_to_agent",
      description:
        "Send a direct message to another agent teammate. They work independently on their own computer and reply only if a result is needed. Use only when collaboration genuinely helps the current task or the user asked for it — not to broadcast sandbox status.",
      parameters: {
        toAgentName: { type: "string", description: "The teammate's exact name" },
        text: { type: "string", description: "Your message — include all context they need" },
      },
      required: ["toAgentName", "text"],
    });
  }
  return tools;
}

/** Parse a custom-tool call (by name) into a neutral ToolInvocation, or undefined. */
import type { ToolInvocation } from "./types.js";

export function parseCustomToolCall(id: string, name: string, args: Record<string, unknown>): ToolInvocation | undefined {
  switch (name) {
    case "bash":
      return { id, tool: "bash", command: String(args.command ?? "") };
    case "update_memory": {
      const kind = ["preference", "fact", "summary"].includes(String(args.kind)) ? (String(args.kind) as "preference" | "fact" | "summary") : "fact";
      return { id, tool: "update_memory", memoryKind: kind, content: String(args.content ?? "") };
    }
    case "request_approval":
      return { id, tool: "request_approval", description: String(args.description ?? ""), reason: String(args.reason ?? "") };
    case "send_message":
      return { id, tool: "send_message", text: String(args.text ?? "") };
    case "task_complete":
      return { id, tool: "task_complete", summary: String(args.summary ?? "") };
    case "send_message_to_agent":
      return { id, tool: "send_message_to_agent", toAgentName: String(args.toAgentName ?? ""), text: String(args.text ?? "") };
    default:
      return undefined;
  }
}
