/** Cooperative task cancellation: running loops poll their AbortSignal. */

const controllers = new Map<string, AbortController>();

export function registerTask(taskId: string): AbortSignal {
  const c = new AbortController();
  controllers.set(taskId, c);
  return c.signal;
}

export function unregisterTask(taskId: string): void {
  controllers.delete(taskId);
}

export function cancelTask(taskId: string): boolean {
  const c = controllers.get(taskId);
  if (!c) return false;
  c.abort();
  return true;
}
