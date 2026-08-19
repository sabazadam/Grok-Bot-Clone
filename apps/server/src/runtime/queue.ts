/**
 * Per-agent serial task queues. An agent runs ONE computer-use task at a time
 * (matches Grok Bot: "one Bot can run only one computer-use task on its screen
 * at a time"); additional work is queued FIFO. Different agents run in parallel.
 */

type Job = () => Promise<void>;

const queues = new Map<string, { running: boolean; jobs: Job[] }>();

export function enqueue(agentId: string, job: Job): void {
  let q = queues.get(agentId);
  if (!q) {
    q = { running: false, jobs: [] };
    queues.set(agentId, q);
  }
  q.jobs.push(job);
  if (!q.running) void drain(agentId);
}

async function drain(agentId: string): Promise<void> {
  const q = queues.get(agentId);
  if (!q) return;
  q.running = true;
  while (q.jobs.length > 0) {
    const job = q.jobs.shift()!;
    try {
      await job();
    } catch (err) {
      // job-level errors are handled inside jobs; this is a last resort
      console.error(`[queue:${agentId}] job crashed:`, err);
    }
  }
  q.running = false;
}

export function pendingCount(agentId: string): number {
  return queues.get(agentId)?.jobs.length ?? 0;
}

/** Drop queued (not yet started) jobs so a new user message can take priority. */
export function clearPending(agentId: string): number {
  const q = queues.get(agentId);
  if (!q) return 0;
  const n = q.jobs.length;
  q.jobs = [];
  return n;
}
