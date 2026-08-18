import { useEffect, useRef, useState } from "react";
import type { Agent, Conversation, Message } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import { Avatar, STATUS_LABELS } from "./Avatar";

function Bubble({ message, agent }: { message: Message; agent?: Agent }) {
  const { state } = useStore();
  const [busy, setBusy] = useState(false);

  if (message.kind === "activity") {
    return (
      <div className="my-1 flex justify-center">
        <span className="max-w-[80%] truncate rounded-full bg-neutral-800/80 px-3 py-1 text-[11px] text-neutral-400">
          {agent ? `${agent.name} · ` : ""}
          {message.text}
        </span>
      </div>
    );
  }

  if (message.kind === "error") {
    return (
      <div className="my-1 flex justify-center">
        <span className="max-w-[85%] rounded-xl border border-red-900/60 bg-red-950/50 px-3 py-1.5 text-xs text-red-300">
          {message.text}
        </span>
      </div>
    );
  }

  if (message.kind === "approval_request") {
    const approval = message.approvalId ? state.approvals[message.approvalId] : undefined;
    const pending = !approval || approval.status === "pending";
    return (
      <div className="my-2 flex justify-start">
        <div className="max-w-[85%] rounded-2xl border border-orange-700/60 bg-orange-950/40 p-3">
          <div className="mb-1 flex items-center gap-2">
            {agent && <Avatar agent={agent} size={22} showStatus={false} />}
            <span className="text-xs font-semibold text-orange-300">Approval needed</span>
          </div>
          <p className="text-sm whitespace-pre-wrap text-neutral-200">{message.text}</p>
          <div className="mt-2 flex gap-2">
            {pending ? (
              <>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.approve(message.approvalId!);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.reject(message.approvalId!);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded-lg bg-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-200 hover:bg-neutral-600 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : (
              <span
                className={`text-xs font-semibold ${approval.status === "approved" ? "text-emerald-400" : "text-red-400"}`}
              >
                {approval.status === "approved" ? "✓ Approved" : "✗ Rejected"}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isUser = message.sender.kind === "user";
  return (
    <div className={`my-1 flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && agent && (
        <div className="mr-2 self-end">
          <Avatar agent={agent} size={26} showStatus={false} />
        </div>
      )}
      <div
        className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap ${
          isUser ? "rounded-br-md bg-sky-600 text-white" : "rounded-bl-md bg-neutral-800 text-neutral-100"
        }`}
      >
        {!isUser && agent && <div className="mb-0.5 text-[11px] font-semibold text-neutral-400">{agent.name}</div>}
        {message.text}
      </div>
    </div>
  );
}

export function ChatView({
  conversation,
  onToggleComputer,
  onOpenProfile,
  computerOpen,
}: {
  conversation: Conversation;
  onToggleComputer: () => void;
  onOpenProfile: () => void;
  computerOpen: boolean;
}) {
  const { state } = useStore();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = state.messages[conversation.id] ?? [];
  const agentById = new Map(state.agents.map((a) => [a.id, a]));
  const members = conversation.agentIds
    .map((id) => agentById.get(id))
    .filter((x): x is Agent => !!x);
  const single = conversation.kind === "direct" ? members[0] : undefined;
  const readOnly = conversation.kind === "agent_dm";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, state.liveSteps]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setSendError(null);
    try {
      await api.sendMessage(conversation.id, text);
    } catch (err) {
      setSendError((err as Error).message);
      setDraft(text);
    }
  }

  const working = members.filter((m) => m.status === "working" || m.status === "starting");

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-neutral-950">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-neutral-100">{conversation.title}</h2>
          <p className="truncate text-xs text-neutral-500">
            {single
              ? `${single.roleTitle || "Agent"} · ${STATUS_LABELS[single.status]}`
              : members.map((m) => m.name).join(", ")}
          </p>
        </div>
        {single && (
          <button
            onClick={onOpenProfile}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Profile
          </button>
        )}
        {members.length > 0 && (
          <button
            onClick={onToggleComputer}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              computerOpen ? "bg-sky-600 text-white" : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {computerOpen ? "Hide computer" : "Agent computer"}
          </button>
        )}
      </header>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-neutral-600">
            {readOnly
              ? "Agents will talk here when they message each other."
              : single
                ? `Give ${conversation.title} its first task. It has its own computer with a browser, terminal, and files.`
                : "Message the group. Address agents with @Name, or leave off mentions to reach everyone."}
          </p>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            agent={m.sender.kind === "agent" ? agentById.get(m.sender.agentId) : undefined}
          />
        ))}
        {working.map((m) => {
          const live = state.liveSteps[m.id];
          return (
            <div key={m.id} className="my-1 flex items-center justify-start gap-2">
              <Avatar agent={m} size={22} showStatus={false} />
              <span className="flex items-center gap-2 rounded-full bg-neutral-800/90 px-3 py-1 text-[11px] text-neutral-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                {m.status === "starting" ? "booting its computer…" : (live?.caption ?? "working…")}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      {!readOnly && (
        <footer className="border-t border-neutral-800 p-3">
          {sendError && <p className="mb-1 px-2 text-xs text-red-400">{sendError}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={Math.min(5, Math.max(1, draft.split("\n").length))}
              placeholder={conversation.kind === "group" ? "Message the group — use @Name to address one agent" : `Message ${conversation.title}…`}
              className="flex-1 resize-none rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-[15px] text-neutral-100 placeholder-neutral-600 focus:border-sky-600 focus:outline-none"
            />
            <button
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
              title="Send"
            >
              ↑
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
