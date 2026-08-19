/**
 * Agent task runner — the multi-model computer-use loop.
 *
 * screenshot → model decides → execute tools on the agent's own OS → feed results
 * back → repeat, with host-side safety gates, live activity events, cancellation,
 * and a step cap. Provider differences live in the model adapters.
 */
import type { Agent } from "@grokbot/shared";
import * as store from "../store.js";
import { broadcast } from "../bus.js";
import * as service from "../agents/service.js";
import { computerManager } from "../computer/manager.js";
import { config } from "../config.js";
import { createAdapter, describeInvocation, type AgentDecision, type ToolOutcome } from "../models/index.js";
import { buildSystemPrompt, buildTaskPrompt } from "./prompt.js";
import { evaluateInvocation, describeExactAction } from "./safety.js";
import { requestApproval } from "./approvals.js";
import { registerTask, unregisterTask } from "./cancel.js";
import { waitWhileTakenOver } from "./takeover.js";
import { executeInvocation } from "./tools.js";
import { extractMentions, dispatchAgentMessage } from "./orchestrator.js";
import { communicationCaption, isSilentReply, shouldPostToolToChat } from "./report.js";

export interface RunTaskOptions {
  agentId: string;
  conversationId: string;
  prompt: string;
  rootMessageId: string;
  triggeredBy: { kind: "user" } | { kind: "agent"; agentId: string };
}

function postAgentText(agent: Agent, conversationId: string, text: string): void {
  if (!text.trim()) return;
  const msg = store.addMessage({
    conversationId,
    sender: { kind: "agent", agentId: agent.id },
    kind: "text",
    text: text.trim(),
  });
  broadcast({ type: "message", message: msg });
}

export async function runAgentTask(opts: RunTaskOptions): Promise<void> {
  const agent = store.getAgent(opts.agentId);
  const conversation = store.getConversation(opts.conversationId);
  if (!agent || !conversation) return;

  const task = store.createTask(agent.id, conversation.id, opts.prompt);
  const signal = registerTask(task.id);
  service.setStatus(agent.id, "working");
  store.updateTask(task.id, { status: "running" });
  broadcast({ type: "task_updated", task: store.getTask(task.id)! });

  let finalText = "";
  let failed = false;

  try {
    await computerManager.ensureRunning(agent.id);
    await service.syncBrowserConfig(agent.id);
    const firstShot = await computerManager.screenshot(agent.id);

    const adapter = createAdapter(agent, buildSystemPrompt(agent));
    let decision: AgentDecision = await adapter.start(buildTaskPrompt(agent, conversation, opts), firstShot.toString("base64"));

    let stepIndex = 0;

    loop: while (true) {
      if (signal.aborted) {
        finalText = "Task cancelled.";
        store.updateTask(task.id, { status: "cancelled", finishedAt: Date.now() });
        break;
      }

      if (decision.kind === "final") {
        finalText = decision.text;
        store.updateTask(task.id, { status: "done", finishedAt: Date.now(), resultSummary: finalText.slice(0, 500) });
        break;
      }

      // Model thoughts / "I'll click X" narration stay internal — never chat.
      // Agents speak only via send_message, send_message_to_agent, or task_complete.

      const outcomes: ToolOutcome[] = [];
      for (const inv of decision.invocations) {
        // pause while the user has manual control of this agent's screen
        await waitWhileTakenOver(agent.id, signal);
        if (signal.aborted) {
          finalText = "Task cancelled.";
          store.updateTask(task.id, { status: "cancelled", finishedAt: Date.now() });
          break loop;
        }

        stepIndex += 1;
        if (stepIndex > config.maxTaskSteps) {
          finalText = `I hit the step limit (${config.maxTaskSteps}) before finishing. Progress so far is saved on my computer — tell me to continue if you want me to keep going.`;
          store.updateTask(task.id, { status: "done", finishedAt: Date.now(), resultSummary: "step limit reached" });
          break loop;
        }

        // ── explicit approval request from the model ──
        if (inv.tool === "request_approval") {
          service.setStatus(agent.id, "waiting_approval");
          const verdictDecision = await requestApproval({
            taskId: task.id,
            agentId: agent.id,
            conversationId: conversation.id,
            actionDescription: inv.description,
            actionJson: JSON.stringify(inv),
            reason: inv.reason,
          });
          service.setStatus(agent.id, "working");
          outcomes.push({
            id: inv.id,
            tool: inv.tool,
            output:
              verdictDecision === "approved"
                ? "APPROVED — you may proceed with exactly this action"
                : "REJECTED by the user — do not do this; adjust your plan or finish",
          });
          continue;
        }

        // ── host-side safety gate (plus provider safety flags) ──
        const verdict = inv.needsConfirmation
          ? { needsApproval: true, reason: inv.needsConfirmation }
          : evaluateInvocation(inv);
        if (verdict.needsApproval) {
          service.setStatus(agent.id, "waiting_approval");
          const approvalDecision = await requestApproval({
            taskId: task.id,
            agentId: agent.id,
            conversationId: conversation.id,
            actionDescription: describeExactAction(inv),
            actionJson: JSON.stringify(inv),
            reason: verdict.reason ?? "flagged as consequential",
          });
          service.setStatus(agent.id, "working");
          if (approvalDecision !== "approved") {
            finalText = `I stopped: you ${approvalDecision === "timeout" ? "didn't respond to" : "rejected"} the approval request (${verdict.reason}). Nothing was executed.`;
            store.updateTask(task.id, { status: "done", finishedAt: Date.now(), resultSummary: "stopped at approval gate" });
            break loop;
          }
        }

        // ── explicit mid-task message (only when the agent chose to speak) ──
        if (inv.tool === "send_message") {
          const text = inv.text.trim();
          if (text && !isSilentReply(text)) {
            postAgentText(agent, conversation.id, text);
          }
          outcomes.push({ id: inv.id, tool: inv.tool, output: text ? "sent" : "empty message ignored" });
          continue;
        }

        // ── completion ──
        if (inv.tool === "task_complete") {
          finalText = inv.summary;
          store.updateTask(task.id, { status: "done", finishedAt: Date.now(), resultSummary: finalText.slice(0, 500) });
          break loop;
        }

        // ── execute ──
        const { outcome, screenshotUrl } = await executeInvocation(
          { agent, taskId: task.id, conversationId: conversation.id, rootMessageId: opts.rootMessageId },
          inv,
          stepIndex,
        );
        outcomes.push(outcome);

        const caption = describeInvocation(inv);
        store.addTaskStep(task.id, stepIndex, caption, JSON.stringify(inv), screenshotUrl);
        store.updateTask(task.id, { stepCount: stepIndex });
        broadcast({ type: "task_step", taskId: task.id, agentId: agent.id, stepIndex, caption, screenshotUrl });
        // Sandbox clicks/commands stay on the computer feed. Chat only gets
        // real communication (a teammate handoff the user should see).
        if (shouldPostToolToChat(inv) && !outcome.isError) {
          const note = communicationCaption(inv);
          if (note) postAgentText(agent, conversation.id, note);
        }
      }

      decision = await adapter.next(outcomes);
    }
  } catch (err) {
    failed = true;
    finalText = "";
    const msg = store.addMessage({
      conversationId: conversation.id,
      sender: { kind: "system" },
      kind: "error",
      text: `${agent.name}'s task failed: ${(err as Error).message}`,
    });
    broadcast({ type: "message", message: msg });
    store.updateTask(task.id, { status: "failed", finishedAt: Date.now(), resultSummary: (err as Error).message.slice(0, 500) });
  } finally {
    unregisterTask(task.id);
  }

  // ── deliver the final reply (ACK / empty = no chat message) ──
  const isAck = isSilentReply(finalText);
  if (!failed && finalText && !isAck) {
    postAgentText(agent, conversation.id, finalText);
  }

  // Note: a delegated agent does NOT auto-forward its reply back to the requester
  // (that caused noisy ping-pong). Its result stays visible in its own chat; if it
  // wants to report back, it explicitly uses send_message_to_agent, which lands in
  // the requester's chat. This keeps agent-to-agent traffic intentional.

  // group-chat handoffs: @mentions in the final reply wake those agents
  if (!failed && conversation.kind === "group" && finalText && !isAck) {
    const others = conversation.agentIds.filter((id) => id !== agent.id).map((id) => store.getAgent(id)).filter((a): a is Agent => !!a);
    const mentioned = extractMentions(finalText, others);
    for (const targetId of mentioned) {
      // dispatch within the group conversation so the whole handoff stays visible
      // (dispatchAgentMessage enforces the per-request turn budget)
      const delivered = dispatchAgentMessage({
        fromAgentId: agent.id,
        toAgentId: targetId,
        conversationId: conversation.id,
        text: finalText,
        rootMessageId: opts.rootMessageId,
      });
      if (!delivered) break;
    }
  }

  // learn from the work: keep a short auto-summary of substantial completed tasks
  const finishedTask = store.getTask(task.id);
  if (!failed && finishedTask?.status === "done" && finishedTask.stepCount >= 3 && finalText && !isAck) {
    store.addMemory(
      agent.id,
      "summary",
      `Task "${opts.prompt.slice(0, 120)}" → ${finalText.slice(0, 200)}`,
    );
  }

  if (finishedTask) broadcast({ type: "task_updated", task: finishedTask });
  service.setStatus(agent.id, "idle");
}
