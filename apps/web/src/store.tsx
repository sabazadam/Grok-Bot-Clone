import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { Agent, Approval, Conversation, Message, ServerEvent, Task } from "@grokbot/shared";
import { api, type AppConfig } from "./api";

export interface LiveStep {
  taskId: string;
  caption: string;
  screenshotUrl?: string;
  at: number;
}

interface State {
  config: AppConfig | null;
  agents: Agent[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  approvals: Record<string, Approval>;
  tasks: Record<string, Task>;
  /** latest live activity per agent */
  liveSteps: Record<string, LiveStep>;
  /** recent sandbox actions per agent (computer panel log, not chat) */
  liveLogs: Record<string, LiveStep[]>;
  selectedId: string | null;
}

type Action =
  | { type: "init"; config: AppConfig; agents: Agent[]; conversations: Conversation[] }
  | { type: "select"; id: string | null }
  | { type: "messages_loaded"; convId: string; messages: Message[] }
  | { type: "approvals_loaded"; approvals: Approval[] }
  | { type: "event"; event: ServerEvent }
  | { type: "agents"; agents: Agent[] };

function upsert<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) return [...arr, item];
  const copy = [...arr];
  copy[i] = item;
  return copy;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "init":
      return { ...state, config: action.config, agents: action.agents, conversations: action.conversations };
    case "agents":
      return { ...state, agents: action.agents };
    case "select":
      return { ...state, selectedId: action.id };
    case "messages_loaded":
      return { ...state, messages: { ...state.messages, [action.convId]: action.messages } };
    case "approvals_loaded": {
      const approvals = { ...state.approvals };
      for (const a of action.approvals) approvals[a.id] = a;
      return { ...state, approvals };
    }
    case "event": {
      const e = action.event;
      switch (e.type) {
        case "message": {
          const list = state.messages[e.message.conversationId];
          const conversations = state.conversations.map((c) =>
            c.id === e.message.conversationId ? { ...c, lastMessageAt: e.message.createdAt } : c,
          );
          if (!list) return { ...state, conversations };
          if (list.some((m) => m.id === e.message.id)) return { ...state, conversations };
          return {
            ...state,
            conversations,
            messages: { ...state.messages, [e.message.conversationId]: [...list, e.message] },
          };
        }
        case "agent_updated":
          return { ...state, agents: upsert(state.agents, e.agent) };
        case "agent_status":
          return {
            ...state,
            agents: state.agents.map((a) => (a.id === e.agentId ? { ...a, status: e.status } : a)),
          };
        case "conversation_updated":
          return { ...state, conversations: upsert(state.conversations, e.conversation) };
        case "task_updated":
          return { ...state, tasks: { ...state.tasks, [e.task.id]: e.task } };
        case "task_step": {
          const step: LiveStep = {
            taskId: e.taskId,
            caption: e.caption,
            screenshotUrl: e.screenshotUrl,
            at: Date.now(),
          };
          const prev = state.liveLogs[e.agentId] ?? [];
          const sameTask = prev.filter((s) => s.taskId === e.taskId);
          return {
            ...state,
            liveSteps: { ...state.liveSteps, [e.agentId]: step },
            liveLogs: { ...state.liveLogs, [e.agentId]: [...sameTask, step].slice(-16) },
          };
        }
        case "approval_created":
        case "approval_resolved":
          return { ...state, approvals: { ...state.approvals, [e.approval.id]: e.approval } };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

const initial: State = {
  config: null,
  agents: [],
  conversations: [],
  messages: {},
  approvals: {},
  tasks: {},
  liveSteps: {},
  liveLogs: {},
  selectedId: null,
};

const Ctx = createContext<{
  state: State;
  dispatch: React.Dispatch<Action>;
  refreshAgents: () => Promise<void>;
  selectConversation: (id: string | null) => void;
} | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = state.selectedId;

  useEffect(() => {
    void (async () => {
      const [config, agents, conversations] = await Promise.all([api.config(), api.agents(), api.conversations()]);
      dispatch({ type: "init", config, agents, conversations });
    })();
  }, []);

  useEffect(() => {
    let closed = false;
    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data as string) as ServerEvent;
          dispatch({ type: "event", event });
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 1500);
      };
    }
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      refreshAgents: async () => {
        dispatch({ type: "agents", agents: await api.agents() });
      },
      selectConversation: (id: string | null) => {
        dispatch({ type: "select", id });
        if (id && !state.messages[id]) {
          void api.messages(id).then((messages) => dispatch({ type: "messages_loaded", convId: id, messages }));
          void api.approvals(id).then((approvals) => dispatch({ type: "approvals_loaded", approvals }));
        }
      },
    }),
    [state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}
