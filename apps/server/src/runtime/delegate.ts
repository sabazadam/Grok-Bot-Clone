/**
 * Hierarchical delegation runtime (Hermes-style spawn / await / summarize).
 *
 * A Team Lead (or orchestrator sub-agent) calls delegate_task with one or more sub-tasks. For each,
 * we resolve an existing teammate or spawn a new PERMANENT specialist, run it in its own private
 * thread with ISOLATED context (only the goal + context provided — never the parent's transcript),
 * and hand only a distilled structured result back to the parent (so the parent's context stays
 * clean). Sub-tasks run in parallel up to a concurrency cap, and the whole hierarchy is persisted in
 * the `delegations` table so the UI can render the tree.
 */
import type { Agent, DelegateResult, DelegationRole } from "@grokbot/shared";
import type { DelegateTaskSpec, ToolInvocation } from "../models/types.js";
import * as store from "../store.js";
import * as service from "../agents/service.js";
import { config } from "../config.js";
import { broadcast } from "../bus.js";
import { enqueueAndWait } from "./queue.js";
import { consumeTurn } from "./orchestrator.js";

export interface DelegateContext {
  parentAgent: Agent;
  rootMessageId: string;
  parentConversationId: string;
  /** Delegation depth of the CURRENT (parent) task; 0 for a top-level lead task. */
  depth: number;
}

export interface RunChildOptions {
  agentId: string;
  conversationId: string;
  goal: string;
  rootMessageId: string;
  parentAgentId: string;
  delegationId: string;
  maxSteps?: number;
  timeoutSec: number;
  depth: number;
}

/** Injectable so unit tests can simulate a child run without Docker/models. */
export type RunChildFn = (opts: RunChildOptions) => Promise<void>;

/** Default: run the child task on its own serial queue and await completion. */
const defaultRunChild: RunChildFn = async (o) => {
  const { runAgentTask } = await import("./runner.js");
  await enqueueAndWait(o.agentId, () =>
    runAgentTask({
      agentId: o.agentId,
      conversationId: o.conversationId,
      prompt: o.goal,
      rootMessageId: o.rootMessageId,
      triggeredBy: { kind: "agent", agentId: o.parentAgentId },
      delegation: { id: o.delegationId, maxSteps: o.maxSteps, timeoutSec: o.timeoutSec, depth: o.depth },
    }),
  );
};

interface Prepared {
  spec: DelegateTaskSpec;
  child?: Agent;
  delegationId?: string;
  threadId?: string;
  error?: string;
}

/** Combine the goal + optional context into the isolated prompt the sub-agent receives. */
export function composeGoal(spec: DelegateTaskSpec): string {
  const goal = spec.goal.trim();
  return spec.context?.trim() ? `${goal}\n\nContext:\n${spec.context.trim()}` : goal;
}

async function prepareChild(ctx: DelegateContext, spec: DelegateTaskSpec, childDepth: number): Promise<Prepared> {
  const role: DelegationRole = spec.role === "orchestrator" ? "orchestrator" : "leaf";
  let child: Agent | undefined;

  if (spec.agentName) {
    const found = store.getAgentByName(spec.agentName);
    if (!found) return { spec, error: `no teammate named "${spec.agentName}"` };
    if (found.id === ctx.parentAgent.id) return { spec, error: "cannot delegate to yourself" };
    if (!found.collaborationEnabled) return { spec, error: `${found.name} has collaboration disabled` };
    child = found;
  } else if (spec.spawn?.name) {
    const existing = store.getAgentByName(spec.spawn.name);
    if (existing) {
      // Name already taken — reuse that teammate rather than erroring.
      child = existing;
    } else {
      if (store.rosterCount() >= store.ROSTER_LIMIT) {
        return { spec, error: "roster limit reached (50) — reuse an existing teammate instead of spawning" };
      }
      const toolPolicy = spec.spawn.toolPolicy ?? (role === "orchestrator" ? "full" : "research");
      const parent = ctx.parentAgent;
      child = await service.createAgent({
        name: spec.spawn.name.trim(),
        roleTitle: (spec.spawn.roleTitle ?? "Specialist").trim(),
        instructions: (spec.spawn.instructions ?? "").trim(),
        avatarColor: parent.avatarColor,
        provider: parent.provider,
        model: parent.model,
        collaborationEnabled: true,
        stealthBrowsing: parent.stealthBrowsing,
        browserEngine: parent.browserEngine,
        isTeamLead: false,
        team: parent.team,
        agentKind: "specialist",
        parentAgentId: parent.id,
        toolPolicy,
      });
    }
  } else {
    return { spec, error: "each task needs an agentName or spawn.name" };
  }

  // Private lead↔specialist thread carries the handoff (view-only in the UI).
  const thread = store.ensureAgentDm(ctx.parentAgent.id, child.id);
  const goalMsg = store.addMessage({
    conversationId: thread.id,
    sender: { kind: "agent", agentId: ctx.parentAgent.id },
    kind: "text",
    text: composeGoal(spec),
  });
  broadcast({ type: "message", message: goalMsg });

  const delegation = store.createDelegation({
    rootMessageId: ctx.rootMessageId,
    parentAgentId: ctx.parentAgent.id,
    childAgentId: child.id,
    conversationId: thread.id,
    goal: composeGoal(spec),
    role,
    depth: childDepth,
  });
  broadcast({ type: "delegation_updated", delegation });

  return { spec, child, delegationId: delegation.id, threadId: thread.id };
}

/** Render the aggregated structured result the parent model receives (context stays compact). */
function formatResults(results: DelegateResult[]): string {
  if (results.length === 0) return "No sub-tasks were delegated.";
  const lines = results.map((r) => {
    const head = `- ${r.childAgentName} [${r.status}${r.steps ? `, ${r.steps} steps` : ""}]`;
    return `${head}: ${(r.summary || "(no summary)").slice(0, 600)}`;
  });
  return `Delegated ${results.length} task(s); structured results:\n${lines.join("\n")}`;
}

/**
 * Execute a delegate_task invocation: prepare each sub-agent, run them (respecting the concurrency
 * cap and the per-request turn budget), and return the aggregated structured results.
 */
export async function runDelegation(
  ctx: DelegateContext,
  inv: Extract<ToolInvocation, { tool: "delegate_task" }>,
  runChild: RunChildFn = defaultRunChild,
): Promise<{ output: string; results: DelegateResult[]; firstThreadId?: string }> {
  const tasks = inv.tasks ?? [];
  if (tasks.length === 0) {
    return { output: "delegate_task had no valid tasks (each needs a goal and an agentName or spawn.name).", results: [] };
  }

  const childDepth = ctx.depth + 1;
  if (childDepth > config.maxSpawnDepth) {
    return {
      output: `Delegation refused: maximum spawn depth (${config.maxSpawnDepth}) reached. As a sub-agent you cannot delegate further — do the work yourself and report back.`,
      results: [],
    };
  }

  const concurrency = Math.max(1, Math.min(inv.concurrency ?? config.delegateConcurrency, 6));

  const prepared: Prepared[] = [];
  for (const spec of tasks) prepared.push(await prepareChild(ctx, spec, childDepth));

  const results: DelegateResult[] = new Array(prepared.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < prepared.length) {
      const i = cursor++;
      const p = prepared[i]!;
      const name = p.child?.name ?? p.spec.agentName ?? p.spec.spawn?.name ?? "?";

      if (p.error || !p.child || !p.delegationId || !p.threadId) {
        results[i] = {
          delegationId: p.delegationId ?? "",
          childAgentId: p.child?.id ?? "",
          childAgentName: name,
          status: "failed",
          summary: p.error ?? "could not prepare sub-agent",
          steps: 0,
        };
        continue;
      }

      // Respect the per-request agent-turn budget (loop prevention).
      if (!consumeTurn(ctx.rootMessageId)) {
        store.updateDelegation(p.delegationId, { status: "skipped_budget", resultSummary: "turn budget exhausted", finishedAt: Date.now() });
        const d = store.getDelegation(p.delegationId);
        if (d) broadcast({ type: "delegation_updated", delegation: d });
        results[i] = { delegationId: p.delegationId, childAgentId: p.child.id, childAgentName: name, status: "skipped_budget", summary: "turn budget exhausted for this request", steps: 0 };
        continue;
      }

      try {
        await runChild({
          agentId: p.child.id,
          conversationId: p.threadId,
          goal: composeGoal(p.spec),
          rootMessageId: ctx.rootMessageId,
          parentAgentId: ctx.parentAgent.id,
          delegationId: p.delegationId,
          maxSteps: p.spec.maxSteps,
          timeoutSec: p.spec.timeoutSec ?? config.delegateDefaultTimeoutSec,
          depth: childDepth,
        });
      } catch (err) {
        store.updateDelegation(p.delegationId, { status: "failed", resultSummary: (err as Error).message, finishedAt: Date.now() });
        const d = store.getDelegation(p.delegationId);
        if (d) broadcast({ type: "delegation_updated", delegation: d });
      }

      const d = store.getDelegation(p.delegationId);
      results[i] = {
        delegationId: p.delegationId,
        childAgentId: p.child.id,
        childAgentName: name,
        status: d?.status ?? "failed",
        summary: d?.resultSummary ?? "(no result)",
        steps: d?.stepCount ?? 0,
      };
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, prepared.length) }, () => worker()));

  return { output: formatResults(results), results, firstThreadId: prepared.find((p) => p.threadId)?.threadId };
}
