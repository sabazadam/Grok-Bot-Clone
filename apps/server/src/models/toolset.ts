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

/**
 * Neutral custom-tool schemas, filtered to the tools this agent's policy allows.
 * `allowed` is the resolved set of tool names (see runtime/toolPolicy.resolveAllowedTools); it always
 * contains the always-allowed reporting/safety/completion tools. Tools not present are omitted from
 * the schema advertised to the model (schema-layer enforcement).
 */
export function customTools(allowed: Set<string>): NeutralTool[] {
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
      name: "save_skill",
      description:
        "Save a reusable skill (how to do a task: when to use it, inputs, steps, validation, output, approval boundaries). Skills are available across teammates; you get it enabled. Use after a process works.",
      parameters: {
        name: { type: "string", description: "Short skill name, e.g. Weekly account health" },
        description: { type: "string", description: "One-line when-to-use" },
        instructions: { type: "string", description: "Full method: steps, validation, output, what needs approval" },
      },
      required: ["name", "instructions"],
    },
    {
      name: "create_agent",
      description:
        "Create a focused teammate when a job needs a long-lived owner. Ask the user before creating several. Copies your model settings. In a group, the new teammate joins the group.",
      parameters: {
        name: { type: "string", description: "Short unique name" },
        roleTitle: { type: "string", description: "Job title, e.g. Researcher" },
        instructions: { type: "string", description: "What they own, how they work, approval boundaries" },
        isTeamLead: { type: "boolean", description: "If true, they coordinate unmentioned group messages" },
      },
      required: ["name", "instructions"],
    },
    {
      name: "create_routine",
      description:
        'Schedule repeating work on YOUR computer. Prefer a natural schedule: "every morning", "every evening", "every weekday at 8 AM", "every 30 minutes until 4 AM". The routine posts in your chat when it runs.',
      parameters: {
        name: { type: "string", description: "Routine name" },
        prompt: { type: "string", description: "What to do each run (or extra input if a skill is named)" },
        schedule: {
          type: "string",
          description: 'When to run, e.g. "every morning", "every evening", "weekdays at 8am", "every 30 minutes until 4 AM"',
        },
        intervalMinutes: { type: "number", description: "Fallback: minutes between runs if schedule is omitted" },
        skillName: { type: "string", description: "Optional existing skill to run" },
      },
      required: ["name", "prompt"],
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
      name: "call_plugin",
      description:
        "Call a configured plugin / MCP connector. Use the plugin id (or name) and the tool name from the Plugins section of your system prompt. Not for routine sandbox work.",
      parameters: {
        pluginId: { type: "string", description: "Plugin id or exact plugin name" },
        toolName: { type: "string", description: "Tool to invoke on that plugin" },
        arguments: { type: "object", description: "JSON arguments for the tool" },
      },
      required: ["pluginId", "toolName"],
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
  // Only advertise the tools this agent's policy allows (always-allowed tools are always present).
  return tools.filter((t) => allowed.has(t.name));
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
    case "save_skill":
      return {
        id,
        tool: "save_skill",
        name: String(args.name ?? ""),
        description: String(args.description ?? ""),
        instructions: String(args.instructions ?? ""),
      };
    case "create_agent":
      return {
        id,
        tool: "create_agent",
        name: String(args.name ?? ""),
        roleTitle: String(args.roleTitle ?? ""),
        instructions: String(args.instructions ?? ""),
        isTeamLead: Boolean(args.isTeamLead),
      };
    case "create_routine":
      return {
        id,
        tool: "create_routine",
        name: String(args.name ?? ""),
        prompt: String(args.prompt ?? ""),
        intervalMinutes: args.intervalMinutes !== undefined ? Number(args.intervalMinutes) : undefined,
        schedule: args.schedule ? String(args.schedule) : undefined,
        skillName: args.skillName ? String(args.skillName) : undefined,
      };
    case "send_message":
      return { id, tool: "send_message", text: String(args.text ?? "") };
    case "task_complete":
      return { id, tool: "task_complete", summary: String(args.summary ?? "") };
    case "call_plugin":
      return {
        id,
        tool: "call_plugin",
        pluginId: String(args.pluginId ?? args.plugin ?? ""),
        toolName: String(args.toolName ?? args.name ?? ""),
        arguments: args.arguments && typeof args.arguments === "object" ? (args.arguments as Record<string, unknown>) : {},
      };
    case "send_message_to_agent":
      return { id, tool: "send_message_to_agent", toAgentName: String(args.toAgentName ?? ""), text: String(args.text ?? "") };
    default:
      return undefined;
  }
}
