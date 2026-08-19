import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { Agent, Approval, Conversation, Message, Routine, ServerEvent, Skill, Task } from "@grokbot/shared";
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
  skills: Skill[];
  routines: Routine[];
  selectedId: string | null;
}

type Action =
  | { type: "init"; config: AppConfig; agents: Agent[]; conversations: Conversation[]; skills: Skill[]; routines: Routine[] }
  | { type: "select"; id: string | null }
  | { type: "messages_loaded"; convId: string; messages: Message[] }
  | { type: "approvals_loaded"; approvals: Approval[] }
  | { type: "conversations"; conversations: Conversation[] }
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
      return {
        ...state,
        config: action.config,
        agents: action.agents,
        conversations: action.conversations,
        skills: action.skills,
        routines: action.routines,
      };
    case "agents":
      return { ...state, agents: action.agents };
    case "conversations":
      return { ...state, conversations: action.conversations };
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
        case "skill_updated":
          return { ...state, skills: upsert(state.skills, e.skill) };
        case "skill_deleted":
          return { ...state, skills: state.skills.filter((s) => s.id !== e.skillId) };
        case "routine_updated":
          return { ...state, routines: upsert(state.routines, e.routine) };
        case "routine_deleted":
          return { ...state, routines: state.routines.filter((r) => r.id !== e.routineId) };
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
  skills: [],
  routines: [],
  selectedId: null,
};

const Ctx = createContext<{
  state: State;
  dispatch: React.Dispatch<Action>;
  refreshAgents: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  loadMessages: (id: string) => Promise<void>;
  selectConversation: (id: string | null) => void;
} | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = state.selectedId;

  useEffect(() => {
    void (async () => {
      const [config, agents, conversations, skills, routines] = await Promise.all([
        api.config(),
        api.agents(),
        api.conversations(),
        api.skills().catch(() => [] as Skill[]),
        api.routines().catch(() => [] as Routine[]),
      ]);
      dispatch({ type: "init", config, agents, conversations, skills, routines });
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

  const refreshAgents = useCallback(async () => {
    dispatch({ type: "agents", agents: await api.agents() });
  }, []);

  const refreshConversations = useCallback(async () => {
    dispatch({ type: "conversations", conversations: await api.conversations() });
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const messages = await api.messages(id);
    dispatch({ type: "messages_loaded", convId: id, messages });
    try {
      const approvals = await api.approvals(id);
      dispatch({ type: "approvals_loaded", approvals });
    } catch {
      /* agent_dm threads may not expose approvals */
    }
  }, []);

  const selectConversation = useCallback((id: string | null) => {
    dispatch({ type: "select", id });
    if (id) {
      void api.messages(id).then((messages) => dispatch({ type: "messages_loaded", convId: id, messages }));
      void api.approvals(id).then((approvals) => dispatch({ type: "approvals_loaded", approvals })).catch(() => undefined);
    }
  }, []);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      refreshAgents,
      refreshConversations,
      loadMessages,
      selectConversation,
    }),
    [state, refreshAgents, refreshConversations, loadMessages, selectConversation],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}
