/** Executes neutral tool invocations against an agent's computer / the message bus / memory. */
import fs from "node:fs";
import path from "node:path";
import type { Agent, ComputerAction } from "@grokbot/shared";
import type { ToolInvocation, ToolOutcome } from "../models/types.js";
import { computerManager } from "../computer/manager.js";
import { config } from "../config.js";
import * as store from "../store.js";
import { broadcast } from "../bus.js";
import * as service from "../agents/service.js";
import { deliverAgentMessage } from "./orchestrator.js";
import { callPlugin } from "../plugins/runtime.js";
import { isToolAllowed } from "./toolPolicy.js";
import { TOOL_POLICY_LABELS } from "@grokbot/shared";
import { saveAttachments } from "../uploads.js";

/** Best-effort image MIME from a filename extension. */
function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    avif: "image/avif",
  };
  return map[ext] ?? "application/octet-stream";
}

export interface ExecContext {
  agent: Agent;
  taskId: string;
  conversationId: string;
  rootMessageId: string;
  signal?: AbortSignal;
  /** Delegation depth of the CURRENT task (0 for user/normal tasks). */
  depth?: number;
}

async function execComputerAction(
  agentId: string,
  action: ComputerAction,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; output?: string }> {
  if (action.type === "batch") {
    for (const step of action.steps) {
      const r = await execComputerAction(agentId, step, signal);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (action.type === "screenshot") {
    return { ok: true }; // the caller always captures a fresh screenshot afterwards
  }
  const res = await computerManager.act(agentId, action, signal);
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

  // ── tool-policy enforcement (authoritative guard, independent of the model) ──
  if (!isToolAllowed(agent, inv.tool)) {
    return {
      outcome: {
        id: inv.id,
        tool: inv.tool,
        output: `"${inv.tool}" is not permitted by your tool policy (${TOOL_POLICY_LABELS[agent.toolPolicy]}). Use only your allowed tools, or ask the user to change your policy.`,
        isError: true,
      },
    };
  }

  switch (inv.tool) {
    case "computer": {
      try {
        const result = await execComputerAction(agent.id, inv.action, ctx.signal);
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
        const r = await computerManager.exec(agent.id, inv.command, 120, ctx.signal);
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

    case "send_image": {
      try {
        const wantsScreen = !inv.path || inv.path === "screen" || inv.path === "screenshot";
        let files: { name: string; mime: string; dataBase64: string }[];
        if (wantsScreen) {
          const png = await computerManager.screenshot(agent.id);
          files = [{ name: `screenshot-${Date.now()}.png`, mime: "image/png", dataBase64: png.toString("base64") }];
        } else {
          const { buffer, name } = await computerManager.copyFileOut(agent.id, inv.path!);
          if (!buffer.length) {
            return { outcome: { id: inv.id, tool: inv.tool, output: `"${inv.path}" is empty or unreadable`, isError: true } };
          }
          files = [{ name, mime: mimeFromName(name), dataBase64: buffer.toString("base64") }];
        }
        const attachments = saveAttachments(files);
        if (attachments.length === 0) {
          return { outcome: { id: inv.id, tool: inv.tool, output: "couldn't attach the image (too large — 12MB max — or unreadable)", isError: true } };
        }
        const msg = store.addMessage({
          conversationId: ctx.conversationId,
          sender: { kind: "agent", agentId: agent.id },
          kind: "text",
          text: (inv.caption ?? "").trim(),
          attachments,
        });
        broadcast({ type: "message", message: msg });
        const conv = store.getConversation(ctx.conversationId);
        if (conv) broadcast({ type: "conversation_updated", conversation: conv });
        return { outcome: { id: inv.id, tool: inv.tool, output: `sent image "${attachments[0]!.name}" to the chat` } };
      } catch (err) {
        return { outcome: { id: inv.id, tool: inv.tool, output: `couldn't send image: ${(err as Error).message}`, isError: true } };
      }
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
      // Deliver into a view-only lead↔teammate thread (not a sidebar chat).
      const { delivered, conversationId } = deliverAgentMessage({
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
            ? `delivered to ${recipient.name} in a private thread; they will act on their own computer and reply only if a result is needed`
            : `NOT delivered — the agent-to-agent turn budget for this request is exhausted`,
          isError: !delivered,
          relatedConversationId: conversationId,
        },
      };
    }

    case "save_skill": {
      const name = inv.name.trim();
      if (!name || !inv.instructions.trim()) {
        return { outcome: { id: inv.id, tool: inv.tool, output: "name and instructions are required", isError: true } };
      }
      if (store.getSkillByName(name)) {
        return { outcome: { id: inv.id, tool: inv.tool, output: `a skill named "${name}" already exists`, isError: true } };
      }
      const skill = store.createSkill({
        name,
        description: inv.description.trim(),
        instructions: inv.instructions.trim(),
        createdByAgentId: agent.id,
      });
      broadcast({ type: "skill_updated", skill });
      return { outcome: { id: inv.id, tool: inv.tool, output: `saved skill "${skill.name}" (enabled for you; others can enable it)` } };
    }

    case "create_agent": {
      const name = inv.name.trim();
      if (!name) return { outcome: { id: inv.id, tool: inv.tool, output: "name is required", isError: true } };
      if (store.getAgentByName(name)) {
        return { outcome: { id: inv.id, tool: inv.tool, output: `an agent named "${name}" already exists`, isError: true } };
      }
      if (store.rosterCount() >= store.ROSTER_LIMIT) {
        return { outcome: { id: inv.id, tool: inv.tool, output: "roster limit reached (50 bots + groups)", isError: true } };
      }
      const created = await service.createAgent({
        name,
        roleTitle: inv.roleTitle.trim(),
        instructions: inv.instructions.trim(),
        avatarColor: agent.avatarColor,
        provider: agent.provider,
        model: agent.model,
        collaborationEnabled: true,
        stealthBrowsing: agent.stealthBrowsing,
        browserEngine: agent.browserEngine,
        isTeamLead: !!inv.isTeamLead,
      });
      const conv = store.getConversation(ctx.conversationId);
      if (conv?.kind === "group" && !conv.agentIds.includes(created.id)) {
        const updated = store.setConversationAgents(conv.id, [...conv.agentIds, created.id]);
        if (updated) broadcast({ type: "conversation_updated", conversation: updated });
      }
      return { outcome: { id: inv.id, tool: inv.tool, output: `created teammate ${created.name}` } };
    }

    case "create_routine": {
      const name = inv.name.trim();
      if (!name || !inv.prompt.trim()) {
        return { outcome: { id: inv.id, tool: inv.tool, output: "name and prompt are required", isError: true } };
      }
      let skillId: string | undefined;
      if (inv.skillName) {
        const skill = store.getSkillByName(inv.skillName);
        if (!skill) {
          return { outcome: { id: inv.id, tool: inv.tool, output: `no skill named "${inv.skillName}"`, isError: true } };
        }
        skillId = skill.id;
      }
      const existing = store.listRoutines(agent.id);
      if (existing.length >= 50) {
        return { outcome: { id: inv.id, tool: inv.tool, output: "this agent already has 50 routines", isError: true } };
      }
      let routine;
      try {
        routine = store.createRoutine({
          agentId: agent.id,
          skillId,
          name,
          prompt: inv.prompt.trim(),
          intervalMinutes: inv.intervalMinutes,
          schedule: inv.schedule,
        });
      } catch (err) {
        return { outcome: { id: inv.id, tool: inv.tool, output: (err as Error).message, isError: true } };
      }
      broadcast({ type: "routine_updated", routine });
      return {
        outcome: {
          id: inv.id,
          tool: inv.tool,
          output: `scheduled "${routine.name}" (${routine.scheduleLabel}); next run ${new Date(routine.nextRunAt).toISOString()}`,
        },
      };
    }

    case "update_memory": {
      store.addMemory(agent.id, inv.memoryKind, inv.content.slice(0, 1000));
      return { outcome: { id: inv.id, tool: inv.tool, output: "saved to memory" } };
    }

    case "call_plugin": {
      try {
        const output = await callPlugin(inv.pluginId, inv.toolName, inv.arguments ?? {});
        return { outcome: { id: inv.id, tool: inv.tool, output } };
      } catch (err) {
        return { outcome: { id: inv.id, tool: inv.tool, output: (err as Error).message, isError: true } };
      }
    }

    case "delegate_task": {
      const { runDelegation } = await import("./delegate.js");
      const { output, results, firstThreadId } = await runDelegation(
        {
          parentAgent: agent,
          rootMessageId: ctx.rootMessageId,
          parentConversationId: ctx.conversationId,
          depth: ctx.depth ?? 0,
        },
        inv,
      );
      return {
        outcome: {
          id: inv.id,
          tool: inv.tool,
          output,
          isError: results.length > 0 && results.every((r) => r.status === "failed" || r.status === "skipped_budget"),
          relatedConversationId: firstThreadId,
        },
      };
    }

    case "request_approval":
    case "task_complete": {
      // handled by the runner directly; this is a defensive fallback
      return { outcome: { id: inv.id, tool: inv.tool, output: "ok" } };
    }
  }
}
