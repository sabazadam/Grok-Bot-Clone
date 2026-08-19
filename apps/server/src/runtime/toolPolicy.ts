/**
 * Tool-scoping / role policy resolver.
 *
 * Roles are first-class: a Researcher shouldn't be able to run dangerous shell commands, and a
 * reviewer doesn't need full browser stealth. This module maps an agent's `toolPolicy` (preset) or
 * explicit `toolAllow` list to the concrete set of tools it may use.
 *
 * Reporting / safety / completion tools (send_message, request_approval, task_complete,
 * update_memory) are ALWAYS allowed so any agent can report, ask for approval, remember, and finish.
 *
 * Enforcement happens in three layers (defense in depth):
 *   1. schema     — customTools() only advertises allowed tools to the model.
 *   2. execution  — executeInvocation() rejects a disallowed tool even if a model ignores the schema.
 *   3. prompt     — buildSystemPrompt() states the policy so the model self-limits.
 */
import type { Agent } from "@grokbot/shared";
import {
  ALWAYS_ALLOWED_TOOLS,
  GATEABLE_TOOLS,
  type GateableTool,
  type ToolPolicyName,
} from "@grokbot/shared";

/** Gateable tools each non-custom preset grants. */
const PRESETS: Record<Exclude<ToolPolicyName, "custom">, GateableTool[]> = {
  full: [...GATEABLE_TOOLS],
  // Browse + read + hand off; no shell-write-heavy or roster/schedule mutations.
  research: ["computer", "bash", "call_plugin", "send_message_to_agent"],
  // Shell + files + skills; no browser stealth needed, no roster changes.
  coding: ["bash", "computer", "call_plugin", "save_skill"],
  // Pure GUI browsing.
  browser_only: ["computer", "call_plugin"],
  // Inspect + report only (Code Guardian). No GUI, no roster changes.
  review_only: ["bash", "call_plugin"],
};

/** Tools that require collaboration to be enabled (messaging / spawning other agents). */
const COLLABORATION_TOOLS = new Set<string>(["send_message_to_agent", "delegate_task"]);

/**
 * Resolve the full set of tool names an agent may use, given its policy, custom allow-list, and
 * collaboration flag. Always includes the always-allowed reporting/safety/completion tools.
 */
export function resolveAllowedTools(agent: Pick<Agent, "toolPolicy" | "toolAllow" | "collaborationEnabled">): Set<string> {
  const gateable = new Set<string>(GATEABLE_TOOLS);
  let granted: string[];
  if (agent.toolPolicy === "custom") {
    // Only honor recognized gateable tool names from the custom list.
    granted = (agent.toolAllow ?? []).filter((t) => gateable.has(t));
  } else {
    granted = PRESETS[agent.toolPolicy] ?? PRESETS.full;
  }

  const allowed = new Set<string>(granted);
  // Collaboration-gated tools require the collaboration flag as well.
  if (!agent.collaborationEnabled) {
    for (const t of COLLABORATION_TOOLS) allowed.delete(t);
  }
  for (const t of ALWAYS_ALLOWED_TOOLS) allowed.add(t);
  return allowed;
}

/** Whether a specific tool is permitted for this agent. */
export function isToolAllowed(
  agent: Pick<Agent, "toolPolicy" | "toolAllow" | "collaborationEnabled">,
  toolName: string,
): boolean {
  return resolveAllowedTools(agent).has(toolName);
}

/** Human-readable list of the gateable tools this agent has, for the system prompt. */
export function describeAllowedTools(
  agent: Pick<Agent, "toolPolicy" | "toolAllow" | "collaborationEnabled">,
): string {
  const allowed = resolveAllowedTools(agent);
  const gateable = GATEABLE_TOOLS.filter((t) => allowed.has(t));
  return gateable.join(", ") || "(reporting tools only)";
}
