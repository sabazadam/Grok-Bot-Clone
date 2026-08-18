import { useEffect, useRef, useState } from "react";
import type { Agent, Conversation } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import type { useTheme } from "../theme";
import { Avatar, GroupAvatar } from "./Avatar";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

function RowMenu({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { refreshAgents, selectConversation } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const item = "block w-full px-3 py-2 text-left text-sm hover:brightness-95";
  return (
    <div
      ref={ref}
      className="absolute right-2 top-11 z-30 w-40 overflow-hidden rounded-xl gb-pop"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
    >
      <button
        className={item}
        style={{ color: "var(--text)" }}
        onClick={async (e) => {
          e.stopPropagation();
          const copy = await api.duplicateAgent(agent.id);
          await refreshAgents();
          const convs = await api.conversations();
          const direct = convs.find((c) => c.kind === "direct" && c.agentIds[0] === copy.id);
          if (direct) selectConversation(direct.id);
          onClose();
        }}
      >
        Duplicate
      </button>
      <button
        className={item}
        style={{ color: "var(--text)" }}
        onClick={async (e) => {
          e.stopPropagation();
          await api.hideAgent(agent.id, !agent.hidden);
          await refreshAgents();
          onClose();
        }}
      >
        {agent.hidden ? "Unhide" : "Hide from sidebar"}
      </button>
      <button
        className={item}
        style={{ color: "var(--danger)" }}
        onClick={async (e) => {
          e.stopPropagation();
          if (confirm(`Delete ${agent.name}? Its conversation and role are removed.`)) {
            await api.deleteAgent(agent.id, false);
            await refreshAgents();
            selectConversation(null);
          }
          onClose();
        }}
      >
        Delete
      </button>
    </div>
  );
}

export function Sidebar({
  theme,
  onNewAgent,
  onNewGroup,
}: {
  theme: ReturnType<typeof useTheme>;
  onNewAgent: () => void;
  onNewGroup: () => void;
}) {
  const { state, selectConversation } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const agentById = new Map(state.agents.map((a) => [a.id, a]));
  const hiddenIds = new Set(state.agents.filter((a) => a.hidden).map((a) => a.id));
  const hiddenCount = hiddenIds.size;

  function rowFor(conv: Conversation) {
    const isSelected = state.selectedId === conv.id;
    const members = conv.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x);
    const single = conv.kind === "direct" ? members[0] : undefined;
    const live = single ? state.liveSteps[single.id] : undefined;
    const subtitle =
      single && single.status === "working" && live
        ? live.caption
        : single
          ? single.roleTitle || "Agent"
          : `${members.length} agents`;
    return (
      <div key={conv.id} className="group relative">
        <button
          onClick={() => selectConversation(conv.id)}
          className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors"
          style={{ background: isSelected ? "var(--selected)" : "transparent" }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.background = "var(--hover)";
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.background = "transparent";
          }}
        >
          {single ? <Avatar agent={single} size={44} /> : <GroupAvatar agents={members} size={44} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-semibold" style={{ color: isSelected ? "var(--selected-text)" : "var(--text)" }}>
                {conv.title}
              </span>
              <span className="shrink-0 text-[11px]" style={{ color: isSelected ? "var(--selected-text)" : "var(--muted)" }}>
                {timeAgo(conv.lastMessageAt)}
              </span>
            </div>
            <div className="truncate text-[13px]" style={{ color: isSelected ? "var(--selected-text)" : "var(--muted)", opacity: isSelected ? 0.85 : 1 }}>
              {conv.kind === "agent_dm" ? "agent ↔ agent" : subtitle}
            </div>
          </div>
        </button>
        {single && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRowMenu(rowMenu === conv.id ? null : single.id);
            }}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-lg px-1.5 py-0.5 text-lg leading-none group-hover:block"
            style={{ color: isSelected ? "var(--selected-text)" : "var(--muted)" }}
            title="More"
          >
            ⋯
          </button>
        )}
        {rowMenu === single?.id && single && <RowMenu agent={single} onClose={() => setRowMenu(null)} />}
      </div>
    );
  }

  const sorted = [...state.conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const visible = sorted.filter((c) => {
    if (c.kind === "direct" && c.agentIds[0] && hiddenIds.has(c.agentIds[0]) && !showHidden) return false;
    return true;
  });
  const chats = visible.filter((c) => c.kind !== "agent_dm");
  const agentDms = visible.filter((c) => c.kind === "agent_dm");

  return (
    <aside
      className="flex h-full w-[320px] shrink-0 flex-col"
      style={{ background: "var(--sidebar)", borderRight: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-[19px] font-bold tracking-tight" style={{ color: "var(--text)" }}>
          GrokBot
        </h1>
        <div className="flex items-center gap-1.5">
          <button
            onClick={theme.toggle}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[15px] transition-colors"
            style={{ color: "var(--muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title={theme.theme === "light" ? "Switch to dark" : "Switch to light"}
          >
            {theme.theme === "light" ? "🌙" : "☀️"}
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-xl font-light text-white"
              style={{ background: "var(--accent)" }}
              title="New"
            >
              +
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-xl gb-pop"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
              >
                <button
                  className="block w-full px-4 py-2.5 text-left text-sm hover:brightness-95"
                  style={{ color: "var(--text)" }}
                  onClick={() => {
                    setMenuOpen(false);
                    onNewAgent();
                  }}
                >
                  New agent
                </button>
                <button
                  className="block w-full px-4 py-2.5 text-left text-sm hover:brightness-95 disabled:opacity-40"
                  style={{ color: "var(--text)" }}
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
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {chats.length === 0 && (
          <p className="px-3 py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            Create your first agent teammate with the + button.
          </p>
        )}
        {chats.map(rowFor)}

        {agentDms.length > 0 && (
          <>
            <div className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wide uppercase" style={{ color: "var(--muted)" }}>
              Agent ↔ agent
            </div>
            {agentDms.map(rowFor)}
          </>
        )}

        {hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="mt-3 w-full px-3 py-2 text-left text-[12px]"
            style={{ color: "var(--muted)" }}
          >
            {showHidden ? "Hide" : "Show"} hidden ({hiddenCount})
          </button>
        )}
      </div>
    </aside>
  );
}
