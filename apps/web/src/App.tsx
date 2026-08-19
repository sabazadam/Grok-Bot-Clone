import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@grokbot/shared";
import { StoreProvider, useStore } from "./store";
import { useTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { ComputerPanel } from "./components/ComputerPanel";
import { AgentModal, GroupModal } from "./components/AgentModal";
import { ProfileDrawer } from "./components/ProfileDrawer";
import { EmptyState } from "./components/EmptyState";
import { AgentDmView } from "./components/AgentDmView";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { PluginsModal } from "./components/PluginsModal";
import { TeachModal } from "./components/TeachModal";
import { readLastSeen, writeLastSeen, type LastSeenMap } from "./lastSeen";

function Shell() {
  const { state, dispatch, selectConversation, loadMessages, refreshConversations } = useStore();
  const theme = useTheme();
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showComputer, setShowComputer] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editAgent, setEditAgent] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showTeach, setShowTeach] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>();
  const [lastSeen, setLastSeen] = useState<LastSeenMap>(readLastSeen);

  const conversation = state.conversations.find((c) => c.id === state.selectedId);
  const agentById = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const members = conversation
    ? conversation.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x)
    : [];
  const hostAgent = conversation?.kind === "direct" ? members[0] : undefined;

  const handoff = useMemo(() => {
    if (!handoffId) return null;
    const conv = state.conversations.find((c) => c.id === handoffId);
    if (!conv || conv.kind !== "agent_dm") return null;
    return conv;
  }, [handoffId, state.conversations]);

  const setupWarning =
    state.config && (!state.config.dockerAvailable || !state.config.imageAvailable)
      ? !state.config.dockerAvailable
        ? "Docker isn't reachable — start Docker Desktop (or OrbStack), then restart the server."
        : "Agent OS image missing — run: npm run image:build"
      : null;

  const markSeen = (conversationId: string) => {
    const msgs = state.messages[conversationId] ?? [];
    const last = msgs.at(-1);
    const conv = state.conversations.find((c) => c.id === conversationId);
    const at = Math.max(Date.now(), conv?.lastMessageAt ?? 0, last?.createdAt ?? 0);
    setLastSeen((prev) => {
      const entry = { id: last?.id ?? prev[conversationId]?.id ?? "", at };
      if (prev[conversationId]?.id === entry.id && (prev[conversationId]?.at ?? 0) >= at) return prev;
      const next = { ...prev, [conversationId]: entry };
      writeLastSeen(next);
      return next;
    });
  };

  const navigate = (id: string | null, highlightMessageId?: string) => {
    if (state.selectedId && state.selectedId !== id) markSeen(state.selectedId);
    setHandoffId(null);
    setShowComputer(false);
    setShowProfile(false);
    setEditAgent(false);
    setHighlightId(highlightMessageId);
    selectConversation(id);
    if (id) markSeen(id);
  };

  const openHandoff = async (relatedId: string) => {
    await refreshConversations();
    await loadMessages(relatedId);
    setHandoffId(relatedId);
    setShowComputer(false);
  };

  useEffect(() => {
    setHandoffId(null);
  }, [state.selectedId]);

  useEffect(() => {
    if (!handoffId) return;
    const id = setInterval(() => void loadMessages(handoffId), 2500);
    return () => clearInterval(id);
  }, [handoffId, loadMessages]);

  useEffect(() => {
    if (!state.selectedId) return;
    markSeen(state.selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedId, state.messages[state.selectedId ?? ""]?.at(-1)?.id, conversation?.lastMessageAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowNewAgent(true);
      }
      if (e.key === ",") {
        e.preventDefault();
        if (hostAgent) setShowProfile(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hostAgent]);

  useEffect(() => {
    const notice = state.lastNotice;
    if (!notice) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && !document.hasFocus()) {
      const n = new Notification(notice.title, { body: notice.body });
      n.onclick = () => {
        if (notice.conversationId) navigate(notice.conversationId);
      };
    }
    const t = setTimeout(() => dispatch({ type: "clear_notice" }), 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastNotice?.at]);

  const showRail = Boolean(hostAgent) && railOpen;
  const notice = state.lastNotice;

  return (
    <div className="app-shell">
      <Sidebar
        theme={theme}
        lastSeen={lastSeen}
        onNewAgent={() => setShowNewAgent(true)}
        onNewGroup={() => setShowNewGroup(true)}
        onPlugins={() => setShowPlugins(true)}
        onNavigate={navigate}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {setupWarning && (
          <div
            className="px-4 py-1.5 text-xs"
            style={{
              background: "color-mix(in srgb, var(--warn) 15%, var(--bg))",
              color: "var(--warn)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {setupWarning}
          </div>
        )}
        {notice && (
          <button
            type="button"
            onClick={() => {
              if (notice.conversationId) navigate(notice.conversationId);
              dispatch({ type: "clear_notice" });
            }}
            className="px-4 py-2 text-left text-[13px]"
            style={{
              background:
                notice.kind === "needs_input"
                  ? "color-mix(in srgb, var(--wait) 14%, var(--bg))"
                  : "color-mix(in srgb, var(--ok) 12%, var(--bg))",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <span className="font-semibold">{notice.title}</span>
            <span className="ml-2" style={{ color: "var(--muted)" }}>
              {notice.body}
            </span>
          </button>
        )}
        <div className="flex min-h-0 flex-1">
          {!conversation ? (
            <EmptyState onNewAgent={() => setShowNewAgent(true)} />
          ) : handoff ? (
            <AgentDmView conversation={handoff} host={hostAgent} onClose={() => setHandoffId(null)} />
          ) : (
            <ChatView
              conversation={conversation}
              lastSeenId={lastSeen[conversation.id]?.id}
              highlightMessageId={highlightId}
              onOpenHandoff={(id) => void openHandoff(id)}
              onOpenComputer={() => {
                setShowComputer(true);
                setRailOpen(true);
              }}
              onOpenSettings={() => setShowProfile(true)}
              railOpen={railOpen}
              onToggleRail={() => setRailOpen((v) => !v)}
            />
          )}
          {showRail && hostAgent ? (
            showComputer ? (
              <ComputerPanel
                agents={[hostAgent]}
                forceTakeover={showTeach}
                onClose={() => setShowComputer(false)}
                onTeach={() => setShowTeach(true)}
              />
            ) : (
              <WorkspacePanel
                agent={hostAgent}
                onExpandComputer={() => setShowComputer(true)}
                onCreateRoutine={() => setShowProfile(true)}
                onTeach={() => setShowTeach(true)}
                onCollapse={() => setRailOpen(false)}
              />
            )
          ) : null}
        </div>
      </main>

      {showNewAgent && <AgentModal onClose={() => setShowNewAgent(false)} />}
      {showNewGroup && <GroupModal onClose={() => setShowNewGroup(false)} />}
      {showPlugins && <PluginsModal onClose={() => setShowPlugins(false)} />}
      {showTeach && hostAgent && (
        <TeachModal
          agent={hostAgent}
          onClose={() => setShowTeach(false)}
          onOpenComputer={() => {
            setShowComputer(true);
            setRailOpen(true);
          }}
        />
      )}
      {showProfile && hostAgent && !editAgent && (
        <ProfileDrawer
          agent={hostAgent}
          onClose={() => setShowProfile(false)}
          onEdit={() => setEditAgent(true)}
          onTeach={() => setShowTeach(true)}
        />
      )}
      {editAgent && hostAgent && (
        <AgentModal
          existing={hostAgent}
          onClose={() => {
            setEditAgent(false);
            setShowProfile(false);
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
