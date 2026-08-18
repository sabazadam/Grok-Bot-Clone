import { useState } from "react";
import type { Conversation } from "@grokbot/shared";
import { useStore } from "../store";
import { Avatar, GroupAvatar } from "./Avatar";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

export function Sidebar({
  onNewAgent,
  onNewGroup,
}: {
  onNewAgent: () => void;
  onNewGroup: () => void;
}) {
  const { state, selectConversation } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const agentById = new Map(state.agents.map((a) => [a.id, a]));

  function rowFor(conv: Conversation) {
    const isSelected = state.selectedId === conv.id;
    const members = conv.agentIds.map((id) => agentById.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const single = conv.kind === "direct" ? members[0] : undefined;
    const live = single ? state.liveSteps[single.id] : undefined;
    const subtitle =
      single && single.status === "working" && live
        ? live.caption
        : single
          ? single.roleTitle || "Agent"
          : `${members.length} agents`;
    return (
      <button
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
          isSelected ? "bg-sky-600/90" : "hover:bg-neutral-800"
        }`}
      >
        {single ? <Avatar agent={single} size={42} /> : <GroupAvatar agents={members} size={42} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-neutral-100">{conv.title}</span>
            <span className={`shrink-0 text-[11px] ${isSelected ? "text-sky-100" : "text-neutral-500"}`}>
              {timeAgo(conv.lastMessageAt)}
            </span>
          </div>
          <div className={`truncate text-xs ${isSelected ? "text-sky-100" : "text-neutral-400"}`}>
            {conv.kind === "agent_dm" ? "agent ↔ agent" : subtitle}
          </div>
        </div>
      </button>
    );
  }

  const sorted = [...state.conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const chats = sorted.filter((c) => c.kind !== "agent_dm");
  const agentDms = sorted.filter((c) => c.kind === "agent_dm");

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-bold text-neutral-100">GrokBot</h1>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-lg font-bold text-white hover:bg-sky-500"
            title="New"
          >
            +
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800 shadow-xl">
              <button
                className="block w-full px-4 py-2.5 text-left text-sm text-neutral-100 hover:bg-neutral-700"
                onClick={() => {
                  setMenuOpen(false);
                  onNewAgent();
                }}
              >
                New agent
              </button>
              <button
                className="block w-full px-4 py-2.5 text-left text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40"
                disabled={state.agents.length === 0}
                onClick={() => {
                  setMenuOpen(false);
                  onNewGroup();
                }}
              >
                New group chat
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {chats.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-neutral-500">
            Create your first agent teammate with the + button.
          </p>
        )}
        {chats.map(rowFor)}
        {agentDms.length > 0 && (
          <>
            <div className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
              Agent ↔ agent
            </div>
            {agentDms.map(rowFor)}
          </>
        )}
      </div>
    </aside>
  );
}
