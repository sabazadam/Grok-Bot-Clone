/** Cooperative task cancellation: running loops poll their AbortSignal. */
import * as store from "../store.js";

const controllers = new Map<string, { controller: AbortController; agentId: string }>();

export function registerTask(taskId: string, agentId: string): AbortSignal {
  const c = new AbortController();
  controllers.set(taskId, { controller: c, agentId });
  return c.signal;
}

export function unregisterTask(taskId: string): void {
  controllers.delete(taskId);
}

export function hasLiveTask(agentId: string): boolean {
  for (const entry of controllers.values()) {
    if (entry.agentId === agentId) return true;
  }
  return false;
}

/**
 * Abort a live runner if one exists. If the task is only leftover in SQLite
 * (server restarted mid-run), persist-cancel it so Stop / reconcile can clear
 * the ghost "working" state.
 */
export function cancelTask(taskId: string): boolean {
  const entry = controllers.get(taskId);
  if (entry) {
    entry.controller.abort();
    return true;
  }
  const task = store.getTask(taskId);
  if (task && (task.status === "queued" || task.status === "running" || task.status === "waiting_approval")) {
    store.updateTask(taskId, { status: "cancelled", finishedAt: Date.now(), resultSummary: "cancelled" });
    return true;
  }
  return false;
}

export function agentIdForTask(taskId: string): string | undefined {
  return controllers.get(taskId)?.agentId;
}
