/** Provider-agnostic model adapter contract. */
import type { ComputerAction, MemoryKind, Resolution, ToolPolicyName } from "@grokbot/shared";

/** One sub-task in a delegate_task call. */
export interface DelegateTaskSpec {
  /** delegate to an existing teammate by name… */
  agentName?: string;
  /** …or spawn a new permanent specialist */
  spawn?: { name: string; roleTitle?: string; instructions?: string; toolPolicy?: ToolPolicyName };
  goal: string;
  context?: string;
  role?: "leaf" | "orchestrator";
  allowedTools?: string[];
  timeoutSec?: number;
  maxSteps?: number;
}

export type ToolInvocation =
  | { id: string; tool: "computer"; action: ComputerAction }
  | { id: string; tool: "bash"; command: string }
  | { id: string; tool: "send_message"; text: string }
  | { id: string; tool: "send_image"; path?: string; caption?: string }
  | { id: string; tool: "send_message_to_agent"; toAgentName: string; text: string }
  | { id: string; tool: "update_memory"; memoryKind: MemoryKind; content: string }
  | { id: string; tool: "request_approval"; description: string; reason: string }
  | { id: string; tool: "save_skill"; name: string; description: string; instructions: string }
  | { id: string; tool: "create_agent"; name: string; roleTitle: string; instructions: string; isTeamLead?: boolean }
  | { id: string; tool: "create_routine"; name: string; prompt: string; intervalMinutes?: number; schedule?: string; skillName?: string }
  | { id: string; tool: "task_complete"; summary: string }
  | { id: string; tool: "call_plugin"; pluginId: string; toolName: string; arguments: Record<string, unknown> }
  | { id: string; tool: "delegate_task"; tasks: DelegateTaskSpec[]; concurrency?: number };

export interface ToolOutcome {
  id: string;
  tool: ToolInvocation["tool"];
  output: string;
  /** fresh screenshot after computer/bash actions */
  screenshotB64?: string;
  isError?: boolean;
  /** agent↔agent thread created by send_message_to_agent */
  relatedConversationId?: string;
}

export type AgentDecision =
  | {
      kind: "act";
      invocations: (ToolInvocation & {
        /** provider-side safety system requires user confirmation before executing */
        needsConfirmation?: string;
      })[];
      assistantText?: string;
    }
  | { kind: "final"; text: string };

export interface AdapterInit {
  model: string;
  systemPrompt: string;
  resolution: Resolution;
  apiKey: string;
  /** for OpenAI-compatible endpoints (xAI etc.) */
  baseUrl?: string;
  collaborationEnabled: boolean;
  /** Resolved set of tool names this agent may use (policy/role enforcement at the schema layer). */
  allowedTools: string[];
  /** injectable for unit tests */
  fetchFn?: typeof fetch;
}

export interface ModelAdapter {
  /** First model call for a task: prompt + initial screenshot. */
  start(taskPrompt: string, screenshotB64: string): Promise<AgentDecision>;
  /** Subsequent calls, feeding back results of the executed tool invocations. */
  next(outcomes: ToolOutcome[]): Promise<AgentDecision>;
}

/** Human-readable caption for the activity feed. */
export function describeInvocation(inv: ToolInvocation): string {
  switch (inv.tool) {
    case "computer": {
      const a = inv.action;
      switch (a.type) {
        case "screenshot":
          return "Looked at the screen";
        case "left_click":
          return `Clicked at (${a.x}, ${a.y})`;
        case "double_click":
          return `Double-clicked at (${a.x}, ${a.y})`;
        case "triple_click":
          return `Triple-clicked at (${a.x}, ${a.y})`;
        case "right_click":
          return `Right-clicked at (${a.x}, ${a.y})`;
        case "middle_click":
          return `Middle-clicked at (${a.x}, ${a.y})`;
        case "mouse_move":
          return `Moved cursor to (${a.x}, ${a.y})`;
        case "left_click_drag":
          return `Dragged from (${a.startX}, ${a.startY}) to (${a.x}, ${a.y})`;
        case "scroll":
          return `Scrolled ${a.direction}`;
        case "type":
          return `Typed "${a.text.length > 48 ? a.text.slice(0, 48) + "…" : a.text}"`;
        case "key":
          return `Pressed ${a.key}`;
        case "hold_key":
          return `Held ${a.key}`;
        case "wait":
          return `Waited ${Math.round(a.durationMs / 1000)}s`;
        case "cursor_position":
          return "Checked cursor position";
        default:
          return "Computer action";
      }
    }
    case "bash": {
      const cmd = inv.command.length > 64 ? inv.command.slice(0, 64) + "…" : inv.command;
      return `Ran: ${cmd}`;
    }
    case "save_skill":
      return `Saved skill “${inv.name}”`;
    case "create_agent":
      return `Created teammate ${inv.name}`;
    case "create_routine":
      return `Scheduled “${inv.name}”`;
    case "send_message":
      return "Sent a message";
    case "send_image":
      return inv.path ? `Sent image ${inv.path.split("/").pop()}` : "Sent a screenshot to chat";
    case "send_message_to_agent":
      return `Messaged @${inv.toAgentName}`;
    case "update_memory":
      return `Saved a ${inv.memoryKind} to memory`;
    case "request_approval":
      return "Asked for your approval";
    case "task_complete":
      return "Finished the task";
    case "call_plugin":
      return `Called plugin ${inv.pluginId}.${inv.toolName}`;
    case "delegate_task": {
      const names = inv.tasks
        .map((t) => t.agentName || t.spawn?.name)
        .filter(Boolean)
        .join(", ");
      return `Delegated ${inv.tasks.length} task(s)${names ? ` to ${names}` : ""}`;
    }
  }
}
