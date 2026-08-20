/**
 * Computer takeover — the user takes manual control of an agent's screen
 * (passwords, 2FA, CAPTCHAs). While active, the agent's task loop pauses
 * before its next action, mirroring Grok Bot's "computer takeover".
 */

const active = new Set<string>();
const startedAt = new Map<string, number>();

/** Auto-release so a refresh / closed tab cannot pause an agent forever. */
export const TAKEOVER_MAX_MS = 10 * 60 * 1000;

export function setTakeover(agentId: string, on: boolean): void {
  if (on) {
    active.add(agentId);
    startedAt.set(agentId, Date.now());
  } else {
    active.delete(agentId);
    startedAt.delete(agentId);
  }
}

/** Drop takeovers older than TAKEOVER_MAX_MS. Returns the agent ids released. */
export function expireStaleTakeovers(now = Date.now()): string[] {
  const expired: string[] = [];
  for (const [id, started] of startedAt) {
    if (now - started > TAKEOVER_MAX_MS) {
      active.delete(id);
      startedAt.delete(id);
      expired.push(id);
    }
  }
  return expired;
}

export function isTakenOver(agentId: string): boolean {
  expireStaleTakeovers();
  return active.has(agentId);
}

export function listTakeovers(): string[] {
  expireStaleTakeovers();
  return [...active];
}

/** Used after a UI reload so a lost Take-over session cannot pin the agent. */
export function clearAllTakeovers(): string[] {
  const ids = [...active];
  active.clear();
  startedAt.clear();
  return ids;
}

/** Wait until takeover ends (or the task is cancelled). */
export async function waitWhileTakenOver(agentId: string, signal: AbortSignal): Promise<void> {
  while (isTakenOver(agentId) && !signal.aborted) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
