import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Conversation, SearchHit } from "@grokbot/shared";
import { api } from "../api";
import type { LastSeenMap } from "../lastSeen";
import { useStore } from "../store";
import type { useTheme } from "../theme";
import { Avatar, GroupAvatar } from "./Avatar";
import { RoleBadges } from "./Badges";
import { timeLabel } from "../format";

function isUnread(conv: Conversation | undefined, selectedId: string | null, lastSeen: LastSeenMap): boolean {
  if (!conv || conv.id === selectedId) return false;
  const seen = lastSeen[conv.id];
  if (seen) return conv.lastMessageAt > seen.at;
  return conv.lastMessageAt > conv.createdAt;
}

function RowMenu({
  agent,
  conv,
  onClose,
  onNavigate,
}: {
  agent: Agent;
  conv?: Conversation;
  onClose: () => void;
  onNavigate: (id: string | null, highlightMessageId?: string) => void;
}) {
  const { refreshAgents, refreshConversations } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const item = "block w-full px-3 py-2 text-left text-[13px] hover:brightness-95";
  return (
    <div
      ref={ref}
      className="absolute right-2 top-11 z-30 w-40 overflow-hidden rounded-xl gb-pop"
      style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
    >
      {conv && (
        <button
          className={item}
          style={{ color: "var(--text)" }}
          onClick={async (e) => {
            e.stopPropagation();
            await api.pinConversation(conv.id, !conv.pinned);
            await refreshConversations();
            onClose();
          }}
        >
          {conv.pinned ? "Unpin" : "Pin"}
        </button>
      )}
      <button
        className={item}
        style={{ color: "var(--text)" }}
        onClick={async (e) => {
          e.stopPropagation();
          const copy = await api.duplicateAgent(agent.id);
          await refreshAgents();
          const convs = await api.conversations();
          const direct = convs.find((c) => c.kind === "direct" && c.agentIds[0] === copy.id);
          if (direct) onNavigate(direct.id);
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
        {agent.hidden ? "Show in sidebar" : "Hide from sidebar"}
      </button>
      <button
        className={item}
        style={{ color: "var(--danger)" }}
        onClick={async (e) => {
          e.stopPropagation();
          if (confirm(`Delete ${agent.name}? Its conversation and role are removed.`)) {
            await api.deleteAgent(agent.id, false);
            await refreshAgents();
            onNavigate(null);
          }
          onClose();
        }}
      >
        Delete
      </button>
    </div>
  );
}

function AgentRow({
  agent,
  conv,
  selected,
  unread,
  onOpen,
  onNavigate,
}: {
  agent: Agent;
  conv?: Conversation;
  selected: boolean;
  unread?: boolean;
  onOpen: () => void;
  onNavigate: (id: string | null, highlightMessageId?: string) => void;
}) {
  const { state } = useStore();
  const [menu, setMenu] = useState(false);
  const live = state.liveSteps[agent.id];
  const waiting = agent.status === "waiting_approval";
  const last = (conv ? state.messages[conv.id] : undefined)?.slice(-1)[0];
  const waitingDetail =
    last?.kind === "approval_request" ? last.text : live?.caption;
  const subtitle = waiting
    ? waitingDetail
      ? `Waiting for you: ${waitingDetail}`
      : "Waiting for you"
    : agent.status === "working" && live
      ? live.caption
      : last?.text || agent.roleTitle || "Agent";
  const when = conv?.lastMessageAt ?? agent.createdAt;

  return (
    <div className="group relative">
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-[7px] text-left"
        style={{ background: selected ? "var(--selected)" : "transparent" }}
      >
        <Avatar agent={agent} size={36} showStatus />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold" style={{ color: "var(--text)" }}>
                {conv?.pinned ? "📌 " : ""}
                {agent.name}
              </span>
              <RoleBadges agent={agent} compact />
            </span>
            {!waiting && (
              <span className="shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
                {timeLabel(when)}
              </span>
            )}
          </div>
          <div
            className="truncate text-[12px]"
            style={{ color: waiting ? "var(--wait)" : "var(--muted)", fontWeight: waiting ? 600 : 400 }}
          >
            {subtitle}
          </div>
        </div>
        {waiting && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--wait)" }} />}
        {!waiting && unread && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#3b82f6" }} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenu((v) => !v);
        }}
        className="absolute right-2 top-1/2 hidden -translate-y-1/2 text-[16px] leading-none group-hover:block"
        style={{ color: "var(--muted)" }}
      >
        ⋯
      </button>
      {menu && <RowMenu agent={agent} conv={conv} onClose={() => setMenu(false)} onNavigate={onNavigate} />}
    </div>
  );
}

function Section({
  title,
  children,
  collapsed,
  onToggle,
}: {
  title: string;
  children: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-1">
      <button type="button" onClick={onToggle} className="gb-section flex w-full items-center gap-1.5">
        <span className="text-[9px] opacity-70">{collapsed ? "▶" : "▼"}</span>
        {title}
      </button>
      {!collapsed && children}
    </div>
  );
}

export function Sidebar({
  theme,
  lastSeen,
  onNewAgent,
  onNewGroup,
  onPlugins,
  onNavigate,
}: {
  theme: ReturnType<typeof useTheme>;
  lastSeen: LastSeenMap;
  onNewAgent: () => void;
  onNewGroup: () => void;
  onPlugins: () => void;
  onNavigate: (id: string | null, highlightMessageId?: string) => void;
}) {
  const { state } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const plusRef = useRef<HTMLDivElement>(null);

  const agentById = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const directByAgent = useMemo(() => {
    const m = new Map<string, Conversation>();
    for (const c of state.conversations) {
      if (c.kind === "direct" && c.agentIds[0]) m.set(c.agentIds[0], c);
    }
    return m;
  }, [state.conversations]);

  const q = query.trim().toLowerCase();
  const pinned = state.conversations.filter((c) => {
    if (!c.pinned || c.kind === "agent_dm") return false;
    if (!q) return true;
    if (c.kind === "group") return c.title.toLowerCase().includes(q);
    const agent = agentById.get(c.agentIds[0] ?? "");
    return !!agent && (agent.name.toLowerCase().includes(q) || agent.roleTitle.toLowerCase().includes(q));
  });
  const visible = state.agents.filter((a) => {
    if (a.hidden && !showHidden) return false;
    if (
      q &&
      !a.name.toLowerCase().includes(q) &&
      !a.roleTitle.toLowerCase().includes(q) &&
      !(a.team ?? "").toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
  const pinnedAgentIds = new Set(
    pinned.filter((c) => c.kind === "direct").map((c) => c.agentIds[0]).filter((id): id is string => !!id),
  );
  const pinnedGroupIds = new Set(pinned.filter((c) => c.kind === "group").map((c) => c.id));
  const leaders = visible.filter((a) => a.isTeamLead && !pinnedAgentIds.has(a.id));
  const nonLeaders = visible.filter((a) => !a.isTeamLead && !pinnedAgentIds.has(a.id));
  const teamNames = [...new Set(nonLeaders.map((a) => (a.team ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const unassigned = nonLeaders.filter((a) => !(a.team ?? "").trim());
  const groups = state.conversations.filter((c) => {
    if (c.kind !== "group") return false;
    if (pinnedGroupIds.has(c.id)) return false;
    if (q && !c.title.toLowerCase().includes(q)) return false;
    return true;
  });
  const hiddenCount = state.agents.filter((a) => a.hidden).length;

  useEffect(() => {
    const raw = query.trim();
    if (raw.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void api
        .search(raw)
        .then(setHits)
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function go(id: string | null, highlightMessageId?: string) {
    setQuery("");
    setHits([]);
    onNavigate(id, highlightMessageId);
  }

  function openAgent(agent: Agent) {
    const conv = directByAgent.get(agent.id);
    if (conv) go(conv.id);
  }

  function toggle(title: string) {
    setCollapsed((c) => ({ ...c, [title]: !c[title] }));
  }

  function rows(agents: Agent[]) {
    return agents.map((a) => (
      <AgentRow
        key={a.id}
        agent={a}
        conv={directByAgent.get(a.id)}
        selected={state.selectedId === directByAgent.get(a.id)?.id}
        unread={isUnread(directByAgent.get(a.id), state.selectedId, lastSeen)}
        onOpen={() => openAgent(a)}
        onNavigate={go}
      />
    ));
  }

  return (
    <aside className="flex h-full w-[292px] shrink-0 flex-col" style={{ background: "var(--sidebar)", borderRight: "1px solid var(--hairline)" }}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px]" style={{ color: "var(--muted)" }}>
            ⌕
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="gb-search" />
        </div>
        <div className="relative" ref={plusRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-light"
            style={{ background: "#111", color: "#fff" }}
            title="New"
          >
            +
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl gb-pop"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
            >
              <button
                className="block w-full px-3 py-2 text-left text-[13px]"
                style={{ color: "var(--text)" }}
                onClick={() => {
                  setMenuOpen(false);
                  onNewAgent();
                }}
              >
                New agent
              </button>
              <button
                className="block w-full px-3 py-2 text-left text-[13px] disabled:opacity-40"
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

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {hits.length > 0 && (
          <Section title="Messages" collapsed={!!collapsed.Messages} onToggle={() => toggle("Messages")}>
            {hits.map((h) => (
              <button
                key={h.messageId}
                onClick={() => go(h.conversationId, h.messageId)}
                className="flex w-full flex-col items-start rounded-[14px] px-2 py-[7px] text-left"
              >
                <div className="truncate text-[13px] font-semibold">{h.conversationTitle}</div>
                <div className="line-clamp-2 text-[12px]" style={{ color: "var(--muted)" }}>
                  {h.text}
                </div>
              </button>
            ))}
          </Section>
        )}
        {pinned.length > 0 && (
          <Section title="Pinned" collapsed={!!collapsed.Pinned} onToggle={() => toggle("Pinned")}>
            {pinned.map((c) => {
              if (c.kind === "direct") {
                const agent = agentById.get(c.agentIds[0] ?? "");
                if (!agent || (agent.hidden && !showHidden)) return null;
                return (
                  <AgentRow
                    key={`pin-${c.id}`}
                    agent={agent}
                    conv={c}
                    selected={state.selectedId === c.id}
                    unread={isUnread(c, state.selectedId, lastSeen)}
                    onOpen={() => go(c.id)}
                    onNavigate={go}
                  />
                );
              }
              const groupMembers = c.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x);
              return (
                <button
                  key={`pin-${c.id}`}
                  onClick={() => go(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-[7px] text-left"
                  style={{ background: state.selectedId === c.id ? "var(--selected)" : "transparent" }}
                >
                  <GroupAvatar agents={groupMembers} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">📌 {c.title}</div>
                    <div className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
                      {groupMembers.length} agents
                    </div>
                  </div>
                  {isUnread(c, state.selectedId, lastSeen) && (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#3b82f6" }} />
                  )}
                </button>
              );
            })}
          </Section>
        )}
        {leaders.length > 0 && (
          <Section title="Leaders" collapsed={!!collapsed.Leaders} onToggle={() => toggle("Leaders")}>
            {rows(leaders)}
          </Section>
        )}
        {teamNames.map((team) => (
          <Section key={team} title={team} collapsed={!!collapsed[team]} onToggle={() => toggle(team)}>
            {rows(nonLeaders.filter((a) => (a.team ?? "").trim() === team))}
          </Section>
        ))}
        {unassigned.length > 0 && (
          <Section
            title={leaders.length || teamNames.length ? "Unassigned" : "Teammates"}
            collapsed={!!collapsed.Unassigned}
            onToggle={() => toggle("Unassigned")}
          >
            {rows(unassigned)}
          </Section>
        )}
        {groups.length > 0 && (
          <Section title="Groups" collapsed={!!collapsed.Groups} onToggle={() => toggle("Groups")}>
            {groups.map((c) => {
              const groupMembers = c.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x);
              const selected = state.selectedId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => go(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-[7px] text-left"
                  style={{ background: selected ? "var(--selected)" : "transparent" }}
                >
                  <GroupAvatar agents={groupMembers} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">
                      {c.pinned ? "📌 " : ""}
                      {c.title}
                    </div>
                    <div className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
                      {groupMembers.length} agents
                    </div>
                  </div>
                  {isUnread(c, state.selectedId, lastSeen) && (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#3b82f6" }} />
                  )}
                </button>
              );
            })}
          </Section>
        )}

        {visible.length === 0 && groups.length === 0 && hits.length === 0 && q.length < 2 && (
          <p className="px-3 py-8 text-center text-[13px]" style={{ color: "var(--muted)" }}>
            Create a teammate with +
          </p>
        )}

        {hiddenCount > 0 && (
          <button onClick={() => setShowHidden((v) => !v)} className="mt-2 w-full px-3 py-2 text-left text-[12px]" style={{ color: "var(--muted)" }}>
            {showHidden ? "Hide hidden chats" : "Show hidden chats"} ({hiddenCount})
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: "1px solid var(--hairline)" }}>
        <button
          onClick={onPlugins}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]"
          style={{ color: "var(--text)" }}
          title="Plugins / MCP connectors"
        >
          <span className="text-[15px]">⌁</span> Plugins
          {state.plugins.length > 0 && (
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {state.plugins.length}
            </span>
          )}
        </button>
        <span className="flex-1" />
        <button
          onClick={theme.toggle}
          className="rounded-lg px-2 py-1 text-[13px]"
          style={{ color: "var(--muted)" }}
          title={theme.theme === "light" ? "Dark mode" : "Light mode"}
        >
          {theme.theme === "light" ? "☾" : "☀"}
        </button>
      </div>
    </aside>
  );
}
