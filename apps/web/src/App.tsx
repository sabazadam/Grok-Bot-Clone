import { useMemo, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { ComputerPanel } from "./components/ComputerPanel";
import { AgentModal, GroupModal } from "./components/AgentModal";
import { ProfileDrawer } from "./components/ProfileDrawer";

function Shell() {
  const { state } = useStore();
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showComputer, setShowComputer] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editAgent, setEditAgent] = useState(false);

  const conversation = state.conversations.find((c) => c.id === state.selectedId);
  const agentById = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const members = conversation
    ? conversation.agentIds.map((id) => agentById.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
    : [];
  const single = conversation?.kind === "direct" ? members[0] : undefined;

  const setupWarning =
    state.config && (!state.config.dockerAvailable || !state.config.imageAvailable)
      ? !state.config.dockerAvailable
        ? "Docker isn't reachable — start Docker Desktop (or OrbStack), then restart the server."
        : "Agent OS image missing — run: npm run image:build"
      : null;

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100">
      <Sidebar onNewAgent={() => setShowNewAgent(true)} onNewGroup={() => setShowNewGroup(true)} />
      <main className="flex min-w-0 flex-1 flex-col">
        {setupWarning && (
          <div className="border-b border-amber-900/60 bg-amber-950/50 px-4 py-1.5 text-xs text-amber-300">
            {setupWarning}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {conversation ? (
            <>
              <ChatView
                conversation={conversation}
                computerOpen={showComputer}
                onToggleComputer={() => setShowComputer((v) => !v)}
                onOpenProfile={() => setShowProfile(true)}
              />
              {showComputer && members.length > 0 && (
                <ComputerPanel agents={members} onClose={() => setShowComputer(false)} />
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-600">
              <h2 className="text-xl font-semibold text-neutral-400">Your AI teammates</h2>
              <p className="max-w-sm text-center text-sm">
                Each agent gets a job, a memory, and its own computer. Pick a conversation or create a new agent.
              </p>
            </div>
          )}
        </div>
      </main>

      {showNewAgent && <AgentModal onClose={() => setShowNewAgent(false)} />}
      {showNewGroup && <GroupModal onClose={() => setShowNewGroup(false)} />}
      {showProfile && single && !editAgent && (
        <ProfileDrawer agent={single} onClose={() => setShowProfile(false)} onEdit={() => setEditAgent(true)} />
      )}
      {editAgent && single && (
        <AgentModal
          existing={single}
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
