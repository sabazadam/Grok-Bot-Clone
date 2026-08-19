/** Executes neutral tool invocations against an agent's computer / the message bus / memory. */
import fs from "node:fs";
import path from "node:path";
import type { Agent, ComputerAction } from "@grokbot/shared";
import type { ToolInvocation, ToolOutcome } from "../models/types.js";
import { computerManager } from "../computer/manager.js";
import { config } from "../config.js";
import * as store from "../store.js";
import { deliverAgentMessage } from "./orchestrator.js";

export interface ExecContext {
  agent: Agent;
  taskId: string;
  conversationId: string;
  rootMessageId: string;
}

async function execComputerAction(agentId: string, action: ComputerAction): Promise<{ ok: boolean; error?: string; output?: string }> {
  if (action.type === "batch") {
    for (const step of action.steps) {
      const r = await execComputerAction(agentId, step);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (action.type === "screenshot") {
    return { ok: true }; // the caller always captures a fresh screenshot afterwards
  }
  const res = await computerManager.act(agentId, action);
  if (action.type === "cursor_position" && res.cursor) {
    return { ok: res.ok, error: res.error, output: `cursor at (${res.cursor.x}, ${res.cursor.y})` };
  }
  return { ok: res.ok, error: res.error };
}

function saveScreenshot(taskId: string, step: number, png: Buffer): string {
  const file = `${taskId}_${step}.png`;
  fs.writeFileSync(path.join(config.dataDir, "screenshots", file), png);
  return `/screenshots/${file}`;
}

/**
 * Execute one invocation. Returns the outcome for the model plus presentation
 * details (screenshot URL) for the activity feed.
 */
export async function executeInvocation(
  ctx: ExecContext,
  inv: ToolInvocation,
  stepIndex: number,
): Promise<{ outcome: ToolOutcome; screenshotUrl?: string }> {
  const { agent } = ctx;

  switch (inv.tool) {
    case "computer": {
      try {
        const result = await execComputerAction(agent.id, inv.action);
        // settle, then capture the new state
        await new Promise((r) => setTimeout(r, 300));
        const png = await computerManager.screenshot(agent.id);
        const screenshotUrl = saveScreenshot(ctx.taskId, stepIndex, png);
        const output = result.ok ? result.output || "ok" : `action failed: ${result.error}`;
        return {
          outcome: { id: inv.id, tool: inv.tool, output, screenshotB64: png.toString("base64"), isError: !result.ok },
          screenshotUrl,
        };
      } catch (err) {
        return {
          outcome: { id: inv.id, tool: inv.tool, output: `computer error: ${(err as Error).message}`, isError: true },
        };
      }
    }

    case "bash": {
      try {
        const r = await computerManager.exec(agent.id, inv.command, 120);
        let screenshotUrl: string | undefined;
        let screenshotB64: string | undefined;
        try {
          const png = await computerManager.screenshot(agent.id);
          screenshotUrl = saveScreenshot(ctx.taskId, stepIndex, png);
          screenshotB64 = png.toString("base64");
        } catch {
          /* screenshot best-effort for bash */
        }
        const output = `exit=${r.exitCode}\n${(r.output || "").slice(-6000)}`.trim();
        return {
          outcome: { id: inv.id, tool: inv.tool, output, screenshotB64, isError: !r.ok },
          screenshotUrl,
        };
      } catch (err) {
        return { outcome: { id: inv.id, tool: inv.tool, output: `bash error: ${(err as Error).message}`, isError: true } };
      }
    }

    case "send_message": {
      // posted by the runner so it lands as a real chat message, not an activity pill
      return { outcome: { id: inv.id, tool: inv.tool, output: "sent" } };
    }

    case "send_message_to_agent": {
      if (!agent.collaborationEnabled) {
        return { outcome: { id: inv.id, tool: inv.tool, output: "collaboration is disabled for you", isError: true } };
      }
      const recipient = store.getAgentByName(inv.toAgentName);
      if (!recipient || recipient.id === agent.id) {
        const known = store
          .listAgents()
          .filter((a) => a.id !== agent.id && a.collaborationEnabled)
          .map((a) => a.name)
          .join(", ");
        return {
          outcome: {
            id: inv.id,
            tool: inv.tool,
            output: `no teammate named "${inv.toAgentName}". Teammates: ${known || "(none)"}`,
            isError: true,
          },
        };
      }
      // Deliver into the recipient's OWN chat; they act & reply there.
      const { delivered } = deliverAgentMessage({
        fromAgentId: agent.id,
        toAgentId: recipient.id,
        text: inv.text,
        rootMessageId: ctx.rootMessageId,
      });
      return {
        outcome: {
          id: inv.id,
          tool: inv.tool,
          output: delivered
            ? `delivered to ${recipient.name} in their chat; they will act on their own computer and reply only if a result is needed`
            : `NOT delivered — the agent-to-agent turn budget for this request is exhausted`,
          isError: !delivered,
        },
      };
    }

    case "update_memory": {
      store.addMemory(agent.id, inv.memoryKind, inv.content.slice(0, 1000));
      return { outcome: { id: inv.id, tool: inv.tool, output: "saved to memory" } };
    }

    case "request_approval":
    case "task_complete": {
      // handled by the runner directly; this is a defensive fallback
      return { outcome: { id: inv.id, tool: inv.tool, output: "ok" } };
    }
  }
}
