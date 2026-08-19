/** Interval routines — local stand-in for Grok Bot scheduled workflows. */
import * as store from "../store.js";
import { broadcast } from "../bus.js";
import { enqueue } from "./queue.js";
import { runAgentTask } from "./runner.js";
import { composeSkillPrompt } from "./dispatch.js";
import { newTurnBudget } from "./orchestrator.js";

export function runRoutineNow(routineId: string): boolean {
  const routine = store.getRoutine(routineId);
  if (!routine) return false;
  const agent = store.getAgent(routine.agentId);
  if (!agent) return false;
  const conv = store.ensureDirectConversation(agent.id);
  const skill = routine.skillId ? store.getSkill(routine.skillId) : undefined;
  const prompt = skill
    ? composeSkillPrompt(skill, routine.prompt)
    : `Routine "${routine.name}":\n${routine.prompt}`;

  const notice = store.addMessage({
    conversationId: conv.id,
    sender: { kind: "system" },
    kind: "text",
    text: `Routine started: ${routine.name}`,
  });
  broadcast({ type: "message", message: notice });
  const updated = store.getConversation(conv.id);
  if (updated) broadcast({ type: "conversation_updated", conversation: updated });

  newTurnBudget(notice.id);
  store.markRoutineRan(routine.id, "running");
  const latest = store.getRoutine(routine.id);
  if (latest) broadcast({ type: "routine_updated", routine: latest });

  enqueue(agent.id, () =>
    runAgentTask({
      agentId: agent.id,
      conversationId: conv.id,
      prompt,
      rootMessageId: notice.id,
      triggeredBy: { kind: "user" },
    }),
  );
  return true;
}

export function tickRoutines(now = Date.now()): number {
  const due = store.listDueRoutines(now);
  for (const r of due) runRoutineNow(r.id);
  return due.length;
}

export function startScheduler(): void {
  setInterval(() => {
    try {
      tickRoutines();
    } catch (err) {
      console.error("[scheduler]", err);
    }
  }, 15_000).unref();
}
