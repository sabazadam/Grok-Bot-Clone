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

const LAST_SEEN_KEY = "grokbot.lastSeen";

function readLastSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLastSeen(map: Record<string, string>) {
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
}

function Shell() {
  const { state, selectConversation, loadMessages, refreshConversations } = useStore();
  const theme = useTheme();
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showComputer, setShowComputer] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editAgent, setEditAgent] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<Record<string, string>>(readLastSeen);

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
    if (!last) return;
    const next = { ...lastSeen, [conversationId]: last.id };
    setLastSeen(next);
    writeLastSeen(next);
  };

  const navigate = (id: string | null) => {
    if (state.selectedId && state.selectedId !== id) markSeen(state.selectedId);
    setHandoffId(null);
    setShowComputer(false);
    setShowProfile(false);
    setEditAgent(false);
    selectConversation(id);
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

  const showRail = Boolean(hostAgent) && railOpen;

  return (
    <div className="app-shell">
      <Sidebar theme={theme} onNewAgent={() => setShowNewAgent(true)} onNewGroup={() => setShowNewGroup(true)} onNavigate={navigate} />
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
        <div className="flex min-h-0 flex-1">
          {!conversation ? (
            <EmptyState onNewAgent={() => setShowNewAgent(true)} />
          ) : handoff ? (
            <AgentDmView conversation={handoff} host={hostAgent} onClose={() => setHandoffId(null)} />
          ) : (
            <ChatView
              conversation={conversation}
              lastSeenId={lastSeen[conversation.id]}
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
              <ComputerPanel agents={[hostAgent]} onClose={() => setShowComputer(false)} />
            ) : (
              <WorkspacePanel
                agent={hostAgent}
                onExpandComputer={() => setShowComputer(true)}
                onCreateRoutine={() => setShowProfile(true)}
                onCollapse={() => setRailOpen(false)}
              />
            )
          ) : null}
        </div>
      </main>

      {showNewAgent && <AgentModal onClose={() => setShowNewAgent(false)} />}
      {showNewGroup && <GroupModal onClose={() => setShowNewGroup(false)} />}
      {showProfile && hostAgent && !editAgent && (
        <ProfileDrawer agent={hostAgent} onClose={() => setShowProfile(false)} onEdit={() => setEditAgent(true)} />
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
