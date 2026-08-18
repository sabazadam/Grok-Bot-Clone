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
        <span
          className="max-w-[80%] truncate rounded-full px-3 py-1 text-[11px]"
          style={{ background: "var(--pill)", color: "var(--pill-text)" }}
        >
          {agent ? `${agent.name} · ` : ""}
          {message.text}
        </span>
      </div>
    );
  }

  if (message.kind === "error") {
    return (
      <div className="my-1 flex justify-center">
        <span
          className="max-w-[85%] rounded-xl px-3 py-1.5 text-xs"
          style={{
            background: "color-mix(in srgb, var(--danger) 12%, var(--bg))",
            color: "var(--danger)",
            border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
          }}
        >
          {message.text}
        </span>
      </div>
    );
  }

  if (message.kind === "approval_request") {
    const approval = message.approvalId ? state.approvals[message.approvalId] : undefined;
    const pending = !approval || approval.status === "pending";
    return (
      <div className="my-2 flex justify-start gb-pop">
        <div
          className="max-w-[85%] rounded-2xl p-3"
          style={{ background: "color-mix(in srgb, var(--warn) 12%, var(--bg))", border: "1px solid color-mix(in srgb, var(--warn) 45%, transparent)" }}
        >
          <div className="mb-1 flex items-center gap-2">
            {agent && <Avatar agent={agent} size={22} showStatus={false} />}
            <span className="text-xs font-semibold" style={{ color: "var(--warn)" }}>
              Approval needed
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>
            {message.text}
          </p>
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
                  className="rounded-full px-3.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "var(--ok)" }}
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
                  className="rounded-full px-3.5 py-1 text-xs font-semibold disabled:opacity-50"
                  style={{ background: "var(--surface-2)", color: "var(--text)" }}
                >
                  Reject
                </button>
              </>
            ) : (
              <span className="text-xs font-semibold" style={{ color: approval.status === "approved" ? "var(--ok)" : "var(--danger)" }}>
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
    <div className={`my-0.5 flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && agent && (
        <div className="mr-2 self-end">
          <Avatar agent={agent} size={26} showStatus={false} />
        </div>
      )}
      <div
        className="max-w-[68%] px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap"
        style={{
          background: isUser ? "var(--bubble-user)" : "var(--bubble-agent)",
          color: isUser ? "var(--bubble-user-text)" : "var(--bubble-agent-text)",
          borderRadius: 18,
          borderBottomRightRadius: isUser ? 5 : 18,
          borderBottomLeftRadius: isUser ? 18 : 5,
        }}
      >
        {!isUser && agent && (
          <div className="mb-0.5 text-[11px] font-semibold" style={{ color: "var(--muted)" }}>
            {agent.name}
          </div>
        )}
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
  const members = conversation.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x);
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
    <section className="flex h-full min-w-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <header
        className="flex items-center gap-3 px-4 py-2.5 backdrop-blur"
        style={{ background: "var(--header)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold" style={{ color: "var(--text)" }}>
            {conversation.title}
          </h2>
          <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
            {single ? `${single.roleTitle || "Agent"} · ${STATUS_LABELS[single.status]}` : members.map((m) => m.name).join(", ")}
          </p>
        </div>
        {single && (
          <button
            onClick={onOpenProfile}
            className="rounded-full px-3.5 py-1.5 text-xs font-medium"
            style={{ border: "1px solid var(--border)", color: "var(--text)" }}
          >
            Profile
          </button>
        )}
        {members.length > 0 && (
          <button
            onClick={onToggleComputer}
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={
              computerOpen
                ? { background: "var(--accent)", color: "var(--accent-contrast)" }
                : { border: "1px solid var(--border)", color: "var(--text)" }
            }
          >
            {computerOpen ? "Hide computer" : "Agent computer"}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
            {readOnly
              ? "Agents will talk here when they message each other."
              : single
                ? `Give ${conversation.title} its first task. It has its own computer with a browser, terminal, and files.`
                : "Message the group. Address agents with @Name, or leave off mentions to reach everyone."}
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} agent={m.sender.kind === "agent" ? agentById.get(m.sender.agentId) : undefined} />
        ))}
        {working.map((m) => {
          const live = state.liveSteps[m.id];
          return (
            <div key={m.id} className="my-1 flex items-center justify-start gap-2">
              <Avatar agent={m} size={22} showStatus={false} />
              <span
                className="flex items-center gap-2 rounded-full px-3 py-1 text-[11px]"
                style={{ background: "var(--pill)", color: "var(--pill-text)" }}
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
                {m.status === "starting" ? "booting its computer…" : (live?.caption ?? "working…")}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {!readOnly && (
        <footer className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
          {sendError && (
            <p className="mb-1 px-2 text-xs" style={{ color: "var(--danger)" }}>
              {sendError}
            </p>
          )}
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
              className="flex-1 resize-none rounded-3xl px-4 py-2.5 text-[15px] focus:outline-none"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            <button
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-30"
              style={{ background: "var(--accent)" }}
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
