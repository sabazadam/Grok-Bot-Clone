import type { Agent, Delegation, DelegationStatus, Message } from "@grokbot/shared";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { delegationTargets } from "../format";

const STATUS_COLOR: Record<DelegationStatus, string> = {
  running: "var(--wait)",
  done: "var(--ok)",
  failed: "var(--danger)",
  timeout: "var(--warn)",
  skipped_budget: "var(--muted)",
};

const STATUS_LABEL: Record<DelegationStatus, string> = {
  running: "Working…",
  done: "Done",
  failed: "Failed",
  timeout: "Timed out",
  skipped_budget: "Skipped (budget)",
};

/**
 * Rich card rendered in the parent's chat when a Team Lead delegates. Lists each specialist with a
 * live status dot; clicking a row opens the view-only lead↔specialist thread. Falls back to a simple
 * chip when we can't resolve the targets.
 */
export function DelegationCard({
  message,
  sender,
  onOpen,
  onOpenTree,
}: {
  message: Message;
  sender?: Agent;
  onOpen: (conversationId: string) => void;
  onOpenTree?: () => void;
}) {
  const { state } = useStore();
  const names = delegationTargets(message.text);

  // Resolve each target to its most-recent delegation from this sender.
  const rows = names
    .map((name) => {
      const child = state.agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
      const dels = Object.values(state.delegations)
        .filter((d) => (!sender || d.parentAgentId === sender.id) && (child ? d.childAgentId === child.id : false))
        .sort((a, b) => b.createdAt - a.createdAt);
      const del: Delegation | undefined = dels[0];
      const thread =
        del?.conversationId ||
        (child && sender
          ? state.conversations.find(
              (c) => c.kind === "agent_dm" && c.agentIds.includes(sender.id) && c.agentIds.includes(child.id),
            )?.id
          : undefined);
      return { name, child, del, thread };
    })
    .filter((r) => r.child || r.del);

  if (rows.length === 0) {
    // Fallback: simple chip.
    return (
      <div className="my-2 flex items-center gap-2 text-[13px]" style={{ color: "var(--muted)" }}>
        <span aria-hidden>🌿</span>
        <span>{message.text}</span>
      </div>
    );
  }

  return (
    <div className="my-3 max-w-[440px] rounded-2xl px-4 py-3" style={{ background: "var(--bubble)" }}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--text)" }}>
          <span aria-hidden>🌿</span> Delegated to {rows.length} specialist{rows.length > 1 ? "s" : ""}
        </div>
        {onOpenTree && (
          <button type="button" onClick={onOpenTree} className="text-[12px]" style={{ color: "var(--accent)" }}>
            View tree
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const status = r.del?.status ?? "running";
          return (
            <button
              key={`${r.name}-${i}`}
              type="button"
              disabled={!r.thread}
              onClick={() => r.thread && onOpen(r.thread)}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left disabled:cursor-default"
              style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
            >
              {r.child && <Avatar agent={r.child} size={20} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                  {r.name}
                </span>
                {r.del?.resultSummary && status !== "running" && (
                  <span className="block truncate text-[11px]" style={{ color: "var(--muted)" }}>
                    {r.del.resultSummary}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px]" style={{ color: STATUS_COLOR[status] }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
                {STATUS_LABEL[status]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
