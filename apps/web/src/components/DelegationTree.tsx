import { useMemo } from "react";
import type { Agent, Delegation, DelegationStatus } from "@grokbot/shared";
import { useStore } from "../store";
import { Avatar } from "./Avatar";

const STATUS_COLOR: Record<DelegationStatus, string> = {
  running: "var(--wait)",
  done: "var(--ok)",
  failed: "var(--danger)",
  timeout: "var(--warn)",
  skipped_budget: "var(--muted)",
};

interface TreeNode {
  agent: Agent;
  delegation?: Delegation;
  children: TreeNode[];
}

/**
 * Read-only "Leader → Research Agent → Coding Agent" tree, built from the delegations store.
 * `rootAgentId` roots the tree at a given lead; otherwise every agent that has delegated is a root.
 */
export function DelegationTree({ rootAgentId, onClose }: { rootAgentId?: string; onClose: () => void }) {
  const { state } = useStore();

  const roots = useMemo(() => {
    const agentById = new Map(state.agents.map((a) => [a.id, a]));
    const byParent = new Map<string, Delegation[]>();
    for (const d of Object.values(state.delegations)) {
      const list = byParent.get(d.parentAgentId) ?? [];
      list.push(d);
      byParent.set(d.parentAgentId, list);
    }

    const build = (agentId: string, delegation: Delegation | undefined, seen: Set<string>): TreeNode | undefined => {
      const agent = agentById.get(agentId);
      if (!agent || seen.has(agentId)) return agent ? { agent, delegation, children: [] } : undefined;
      const next = new Set(seen).add(agentId);
      const children = (byParent.get(agentId) ?? [])
        .map((d) => build(d.childAgentId, d, next))
        .filter((n): n is TreeNode => !!n);
      return { agent, delegation, children };
    };

    const parentIds = [...byParent.keys()];
    const rootIds = rootAgentId
      ? [rootAgentId]
      : parentIds.filter((pid) => !Object.values(state.delegations).some((d) => d.childAgentId === pid));
    return rootIds.map((id) => build(id, undefined, new Set())).filter((n): n is TreeNode => !!n);
  }, [state.delegations, state.agents, rootAgentId]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 gb-pop"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>Delegation tree</h2>
          <button onClick={onClose} className="text-[13px]" style={{ color: "var(--muted)" }}>Close</button>
        </div>
        {roots.length === 0 ? (
          <p className="py-8 text-center text-[13px]" style={{ color: "var(--muted)" }}>
            No delegations yet. A Team Lead's <code>delegate_task</code> will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {roots.map((n) => (
              <TreeRow key={n.agent.id} node={n} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const status = node.delegation?.status;
  return (
    <div>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 20 }}>
        {depth > 0 && <span style={{ color: "var(--muted)" }}>↳</span>}
        <Avatar agent={node.agent} size={22} />
        <span className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
          {node.agent.name}
        </span>
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          {node.agent.roleTitle || (depth === 0 ? "Lead" : "Specialist")}
        </span>
        {status && (
          <span className="ml-auto flex items-center gap-1 text-[11px]" style={{ color: STATUS_COLOR[status] }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
            {status}
          </span>
        )}
      </div>
      {node.children.map((c) => (
        <TreeRow key={c.agent.id + (c.delegation?.id ?? "")} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}
