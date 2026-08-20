/** Cooperative task cancellation: running loops poll their AbortSignal. */

const controllers = new Map<string, { controller: AbortController; agentId: string }>();

export function registerTask(taskId: string, agentId: string): AbortSignal {
  const c = new AbortController();
  controllers.set(taskId, { controller: c, agentId });
  return c.signal;
}

/** Throw AbortError so setup (boot / browse / plugins) stops as soon as Stop fires. */
export function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  throw err;
}

export function unregisterTask(taskId: string): void {
  controllers.delete(taskId);
}

export function cancelTask(taskId: string): boolean {
  const entry = controllers.get(taskId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

export function agentIdForTask(taskId: string): string | undefined {
  return controllers.get(taskId)?.agentId;
}
