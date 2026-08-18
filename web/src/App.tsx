import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, connectEvents } from './api';
import type { Agent, Message } from './types';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import ComputerPanel from './components/ComputerPanel';
import AgentModal from './components/AgentModal';
import SettingsModal from './components/SettingsModal';

interface State {
  agents: Agent[];
  selectedId: string | null;
  /** Messages per agent thread, ascending by time. */
  threads: Record<string, Message[]>;
  /** Threads that have been fetched from the server at least once. */
  loaded: Record<string, boolean>;
  unread: Record<string, boolean>;
}

type Action =
  | { type: 'roster'; agents: Agent[] }
  | { type: 'agent_created'; agent: Agent; select?: boolean }
  | { type: 'agent_updated'; agent: Agent }
  | { type: 'agent_deleted'; agentId: string }
  | { type: 'select'; agentId: string }
  | { type: 'thread'; agentId: string; messages: Message[] }
  | { type: 'message'; message: Message };

const initialState: State = {
  agents: [],
  selectedId: null,
  threads: {},
  loaded: {},
  unread: {},
};

let localSeq = 0;
function localId(): string {
  localSeq += 1;
  return `local-${Date.now()}-${localSeq}`;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'roster': {
      const stillSelected =
        state.selectedId !== null && action.agents.some((a) => a.id === state.selectedId);
      return {
        ...state,
        agents: action.agents,
        selectedId: stillSelected ? state.selectedId : (action.agents[0]?.id ?? null),
      };
    }

    case 'agent_created': {
      const exists = state.agents.some((a) => a.id === action.agent.id);
      const agents = exists
        ? state.agents.map((a) => (a.id === action.agent.id ? action.agent : a))
        : [...state.agents, action.agent];
      return {
        ...state,
        agents,
        selectedId: action.select ? action.agent.id : (state.selectedId ?? action.agent.id),
      };
    }

    case 'agent_updated': {
      const exists = state.agents.some((a) => a.id === action.agent.id);
      return {
        ...state,
        agents: exists
          ? state.agents.map((a) => (a.id === action.agent.id ? action.agent : a))
          : [...state.agents, action.agent],
      };
    }

    case 'agent_deleted': {
      const agents = state.agents.filter((a) => a.id !== action.agentId);
      const threads = { ...state.threads };
      const loaded = { ...state.loaded };
      const unread = { ...state.unread };
      delete threads[action.agentId];
      delete loaded[action.agentId];
      delete unread[action.agentId];
      return {
        agents,
        selectedId:
          state.selectedId === action.agentId ? (agents[0]?.id ?? null) : state.selectedId,
        threads,
        loaded,
        unread,
      };
    }

    case 'select':
      return {
        ...state,
        selectedId: action.agentId,
        unread: { ...state.unread, [action.agentId]: false },
      };

    case 'thread': {
      // Fetched history is authoritative; keep newer WS arrivals not in it, and
      // drop optimistic local user messages the server has since persisted.
      const fetchedIds = new Set(action.messages.map((m) => m.id));
      const extras = (state.threads[action.agentId] ?? []).filter((m) => {
        if (fetchedIds.has(m.id)) return false;
        if (m.id.startsWith('local-')) {
          return !action.messages.some((f) => f.role === 'user' && f.content === m.content);
        }
        return true;
      });
      return {
        ...state,
        threads: { ...state.threads, [action.agentId]: [...action.messages, ...extras] },
        loaded: { ...state.loaded, [action.agentId]: true },
      };
    }

    case 'message': {
      const msg = action.message;
      const thread = state.threads[msg.agentId] ?? [];
      if (thread.some((m) => m.id === msg.id)) return state;
      let next = thread;
      if (msg.role === 'user' && !msg.id.startsWith('local-')) {
        // Server echo of a message we appended optimistically.
        const dupe = next.findIndex((m) => m.id.startsWith('local-') && m.content === msg.content);
        if (dupe >= 0) next = next.filter((_, i) => i !== dupe);
      }
      const unread =
        msg.agentId !== state.selectedId && !msg.id.startsWith('local-')
          ? { ...state.unread, [msg.agentId]: true }
          : state.unread;
      return {
        ...state,
        threads: { ...state.threads, [msg.agentId]: [...next, msg] },
        unread,
      };
    }
  }
}

function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 20.5h8M12 17v3.5" />
    </svg>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [wsConnected, setWsConnected] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [agentModal, setAgentModal] = useState<{ agent: Agent | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  // Event stream: seed roster on hello, live-update everything else.
  useEffect(() => {
    const dispose = connectEvents({
      onEvent: (ev) => {
        switch (ev.type) {
          case 'hello':
            dispatch({ type: 'roster', agents: ev.agents });
            break;
          case 'agent_created':
            dispatch({ type: 'agent_created', agent: ev.agent });
            break;
          case 'agent_updated':
            dispatch({ type: 'agent_updated', agent: ev.agent });
            break;
          case 'agent_deleted':
            dispatch({ type: 'agent_deleted', agentId: ev.agentId });
            break;
          case 'message':
            dispatch({ type: 'message', message: ev.message });
            break;
        }
      },
      onOpen: (isReconnect) => {
        if (!isReconnect) return;
        // Fill any gap that opened while we were offline.
        api
          .listAgents()
          .then((agents) => dispatch({ type: 'roster', agents }))
          .catch(() => {});
        const selected = stateRef.current.selectedId;
        if (selected) {
          api
            .getMessages(selected)
            .then((messages) => dispatch({ type: 'thread', agentId: selected, messages }))
            .catch(() => {});
        }
      },
      onStatus: setWsConnected,
    });
    return dispose;
  }, []);

  // Lazy-load the selected agent's thread.
  const { selectedId } = state;
  const threadLoaded = selectedId !== null && state.loaded[selectedId] === true;
  useEffect(() => {
    if (!selectedId || threadLoaded) return;
    let cancelled = false;
    api
      .getMessages(selectedId)
      .then((messages) => {
        if (!cancelled) dispatch({ type: 'thread', agentId: selectedId, messages });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, threadLoaded]);

  const selectedAgent = state.agents.find((a) => a.id === selectedId) ?? null;

  const handleSend = useCallback(
    (content: string) => {
      const agent = stateRef.current.agents.find((a) => a.id === stateRef.current.selectedId);
      if (!agent) return;
      const optimistic: Message = {
        id: localId(),
        agentId: agent.id,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'message', message: optimistic });
      api.sendMessage(agent.id, content).catch((err: Error) => {
        dispatch({
          type: 'message',
          message: {
            id: localId(),
            agentId: agent.id,
            role: 'system',
            content: `Failed to send message: ${err.message}`,
            createdAt: new Date().toISOString(),
          },
        });
      });
    },
    [],
  );

  const handleStop = useCallback(() => {
    const id = stateRef.current.selectedId;
    if (id) api.stopAgent(id).catch(() => {});
  }, []);

  const handleDelete = useCallback((agent: Agent) => {
    if (
      !window.confirm(
        `Delete ${agent.name}? This stops and removes its computer and all of its files.`,
      )
    )
      return;
    api
      .deleteAgent(agent.id)
      .then(() => dispatch({ type: 'agent_deleted', agentId: agent.id }))
      .catch((err: Error) => window.alert(`Could not delete agent: ${err.message}`));
  }, []);

  const handleSaved = useCallback((agent: Agent, created: boolean) => {
    dispatch(
      created
        ? { type: 'agent_created', agent, select: true }
        : { type: 'agent_updated', agent },
    );
    setAgentModal(null);
  }, []);

  const noAgents = state.agents.length === 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <span className="brand-name">Botbox</span>
        </div>
        <div className="topbar-right">
          {!wsConnected && <span className="conn-pill">reconnecting…</span>}
          <button
            className={`icon-btn${panelOpen ? ' active' : ''}`}
            title={panelOpen ? 'Hide computer panel' : 'Show computer panel'}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <MonitorIcon />
          </button>
          <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          agents={state.agents}
          selectedId={selectedId}
          unread={state.unread}
          onSelect={(id) => dispatch({ type: 'select', agentId: id })}
          onNewAgent={() => setAgentModal({ agent: null })}
        />

        <main className="center">
          {noAgents ? (
            <div className="hero">
              <div className="hero-mark">B</div>
              <h1>Meet your first agent</h1>
              <p>
                Give it a name, a role, and a model — it gets its own computer and starts
                working the moment you message it.
              </p>
              <button className="btn primary" onClick={() => setAgentModal({ agent: null })}>
                Create an agent
              </button>
            </div>
          ) : selectedAgent ? (
            <ChatView
              agent={selectedAgent}
              messages={state.threads[selectedAgent.id] ?? []}
              threadLoaded={threadLoaded}
              onSend={handleSend}
              onStop={handleStop}
              onEdit={() => setAgentModal({ agent: selectedAgent })}
              onDelete={() => handleDelete(selectedAgent)}
            />
          ) : (
            <div className="hero">
              <p>Select an agent to start chatting.</p>
            </div>
          )}
        </main>

        {panelOpen && selectedAgent && (
          <ComputerPanel agent={selectedAgent} onCollapse={() => setPanelOpen(false)} />
        )}
      </div>

      {agentModal && (
        <AgentModal
          agent={agentModal.agent}
          onClose={() => setAgentModal(null)}
          onSaved={handleSaved}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
