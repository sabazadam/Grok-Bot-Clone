/**
 * Computer takeover — the user takes manual control of an agent's screen
 * (passwords, 2FA, CAPTCHAs). While active, the agent's task loop pauses
 * before its next action, mirroring Grok Bot's "computer takeover".
 */

const active = new Set<string>();

export function setTakeover(agentId: string, on: boolean): void {
  if (on) active.add(agentId);
  else active.delete(agentId);
}

export function isTakenOver(agentId: string): boolean {
  return active.has(agentId);
}

/** Wait until takeover ends (or the task is cancelled). */
export async function waitWhileTakenOver(agentId: string, signal: AbortSignal): Promise<void> {
  while (isTakenOver(agentId) && !signal.aborted) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
