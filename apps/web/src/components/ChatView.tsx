import { useEffect, useRef, useState } from "react";
import type { Agent, Conversation, Message } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { dayStamp, handoffPeerName, handoffVerb, isHandoffLine, newDividerIndex, shouldStamp } from "../format";

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M19.4 13a7.8 7.8 0 0 0 .06-2l2.04-1.58-2-3.46-2.4.5a8.1 8.1 0 0 0-1.74-1L15 3h-4l-.36 2.46a8.1 8.1 0 0 0-1.74 1l-2.4-.5-2 3.46L6.54 11a7.8 7.8 0 0 0 0 2l-2.04 1.58 2 3.46 2.4-.5a8.1 8.1 0 0 0 1.74 1L11 21h4l.36-2.46a8.1 8.1 0 0 0 1.74-1l2.4.5 2-3.46L19.4 13Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ComputerCard({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const { state } = useStore();
  const live = state.liveSteps[agent.id];
  const done = agent.status === "idle" || agent.status === "off";
  const waiting = agent.status === "waiting_approval";
  const label = waiting
    ? "Waiting"
    : done && live
      ? "Done"
      : agent.status === "working" || agent.status === "starting"
        ? "Working"
        : "Computer";
  const color = waiting ? "var(--wait)" : label === "Done" ? "var(--ok)" : "var(--muted)";
  return (
    <div className="my-3 max-w-[420px] rounded-2xl px-4 py-3" style={{ background: "var(--bubble)" }}>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold" style={{ color }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        {label}
      </div>
      {live?.caption && (
        <p className="mb-3 text-[14px] leading-snug" style={{ color: "var(--text)" }}>
          {live.caption}
        </p>
      )}
      <button
        onClick={onOpen}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium"
        style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
      >
        <span aria-hidden>🖥️</span> Open computer
      </button>
    </div>
  );
}

function HandoffChip({
  message,
  agent,
  onOpen,
}: {
  message: Message;
  agent?: Agent;
  onOpen: (conversationId: string) => void;
}) {
  const { state } = useStore();
  const peerName = handoffPeerName(message.text) ?? "teammate";
  const verb = handoffVerb(message.text);
  const peer = state.agents.find((a) => a.name.toLowerCase() === peerName.toLowerCase());
  const dm =
    message.relatedConversationId ||
    (peer && agent
      ? state.conversations.find(
          (c) => c.kind === "agent_dm" && c.agentIds.includes(agent.id) && c.agentIds.includes(peer.id),
        )?.id
      : undefined);

  return (
    <button
      type="button"
      disabled={!dm}
      onClick={() => {
        if (dm) onOpen(dm);
      }}
      className="my-2 flex items-center gap-2 text-left text-[13px] disabled:cursor-default"
      style={{ color: "var(--muted)" }}
    >
      <span>{verb}</span>
      {peer && <Avatar agent={peer} size={16} />}
      <span className="font-medium" style={{ color: "var(--text)" }}>
        {peerName}
      </span>
    </button>
  );
}

function Bubble({
  message,
  agent,
  onOpenHandoff,
}: {
  message: Message;
  agent?: Agent;
  onOpenHandoff: (conversationId: string) => void;
}) {
  const { state } = useStore();
  const [busy, setBusy] = useState(false);

  if (message.kind === "activity") return null;

  if (message.kind === "error") {
    return (
      <div className="my-2 text-[13px]" style={{ color: "var(--danger)" }}>
        {message.text}
      </div>
    );
  }

  if (message.kind === "approval_request") {
    const approval = message.approvalId ? state.approvals[message.approvalId] : undefined;
    const pending = !approval || approval.status === "pending";
    return (
      <div
        className="my-3 max-w-[440px] rounded-2xl px-4 py-3 gb-pop"
        style={{
          background: "color-mix(in srgb, var(--wait) 10%, var(--bg))",
          border: "1px solid color-mix(in srgb, var(--wait) 35%, transparent)",
        }}
      >
        <div className="mb-1 text-[12px] font-semibold" style={{ color: "var(--wait)" }}>
          Waiting for you
        </div>
        <p className="text-[14px] leading-snug whitespace-pre-wrap">{message.text}</p>
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
                className="rounded-full px-3 py-1 text-[12px] font-semibold text-white"
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
                className="rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ background: "var(--surface)" }}
              >
                Reject
              </button>
            </>
          ) : (
            <span
              className="text-[12px] font-semibold"
              style={{ color: approval.status === "approved" ? "var(--ok)" : "var(--danger)" }}
            >
              {approval.status === "approved" ? "Approved" : "Rejected"}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (isHandoffLine(message.text) || message.relatedConversationId) {
    return <HandoffChip message={message} agent={agent} onOpen={onOpenHandoff} />;
  }

  const isUser = message.sender.kind === "user";
  return (
    <div className="my-2.5">
      {!isUser && agent && (
        <div className="mb-1 flex items-center gap-2">
          <Avatar agent={agent} size={18} />
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            {agent.name}
          </span>
        </div>
      )}
      {isUser && (
        <div className="mb-1 text-[12px]" style={{ color: "var(--muted)" }}>
          You
        </div>
      )}
      <div
        className="max-w-[520px] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.45] whitespace-pre-wrap"
        style={{ background: "var(--bubble)", color: "var(--bubble-text)" }}
      >
        {message.text}
      </div>
      {message.screenshotUrl && <img src={message.screenshotUrl} alt="" className="mt-2 max-h-56 max-w-[360px] rounded-xl" />}
    </div>
  );
}

export function ChatView({
  conversation,
  lastSeenId,
  onOpenHandoff,
  onOpenComputer,
  onOpenSettings,
  railOpen,
  onToggleRail,
}: {
  conversation: Conversation;
  lastSeenId?: string;
  onOpenHandoff: (conversationId: string) => void;
  onOpenComputer: () => void;
  onOpenSettings: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const { state } = useStore();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = state.messages[conversation.id] ?? [];
  const agentById = new Map(state.agents.map((a) => [a.id, a]));
  const members = conversation.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x);
  const single = conversation.kind === "direct" ? members[0] : undefined;
  const working = members.filter((m) => m.status === "working" || m.status === "starting");
  const busy = members.filter((m) => m.status === "working" || m.status === "starting" || m.status === "waiting_approval");
  const skillHits =
    draft.startsWith("/") && !draft.includes("\n")
      ? state.skills.filter((s) => s.name.toLowerCase().startsWith(draft.slice(1).toLowerCase())).slice(0, 6)
      : [];

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.sender.kind === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const dividerAt = newDividerIndex(
    messages.map((m) => m.id),
    lastSeenId,
    lastUserIdx,
  );

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

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <header className="flex items-center gap-2.5 px-5 py-3">
        {single ? <Avatar agent={single} size={28} /> : <span className="text-[15px] font-semibold">{conversation.title}</span>}
        {single && <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{single.name}</h2>}
        {!single && <span className="flex-1" />}
        {working.length > 0 && (
          <button
            onClick={() => void api.stopConversation(conversation.id)}
            className="rounded-full px-3 py-1 text-[12px] font-semibold"
            style={{ color: "var(--danger)" }}
          >
            Stop
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="grid h-8 w-8 place-items-center"
          style={{ color: "var(--muted)" }}
          title="Settings"
        >
          <GearIcon />
        </button>
        {!railOpen && (
          <button
            onClick={onToggleRail}
            className="grid h-8 w-8 place-items-center text-[15px]"
            style={{ color: "var(--muted)" }}
            title="Show panel"
          >
            ≪
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-2">
        {messages.length === 0 && (
          <p className="py-16 text-center text-[14px]" style={{ color: "var(--muted)" }}>
            {single ? `Message ${single.name}` : "Message the group — @Name or @everyone"}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={m.id}>
            {shouldStamp(messages[i - 1]?.createdAt, m.createdAt) && (
              <div className="gb-stamp">{dayStamp(m.createdAt)}</div>
            )}
            {dividerAt === i && (
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1" style={{ background: "#3b82f6" }} />
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "#3b82f6" }}>
                  NEW
                </span>
                <div className="h-px flex-1" style={{ background: "#3b82f6" }} />
              </div>
            )}
            <Bubble
              message={m}
              agent={m.sender.kind === "agent" ? agentById.get(m.sender.agentId) : undefined}
              onOpenHandoff={onOpenHandoff}
            />
          </div>
        ))}
        {single &&
          (single.status === "working" ||
            single.status === "starting" ||
            single.status === "waiting_approval" ||
            state.liveSteps[single.id]) && <ComputerCard agent={single} onOpen={onOpenComputer} />}
        {busy.map((m) =>
          m.id === single?.id ? null : (
            <div key={m.id} className="my-2 flex items-center gap-2 text-[12px]" style={{ color: "var(--muted)" }}>
              <Avatar agent={m} size={18} />
              {m.status === "starting" ? "booting its computer…" : (state.liveSteps[m.id]?.caption ?? "working…")}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="px-4 pb-4">
        {sendError && (
          <p className="mb-1 px-2 text-[12px]" style={{ color: "var(--danger)" }}>
            {sendError}
          </p>
        )}
        <div className="relative">
          {skillHits.length > 0 && (
            <div
              className="absolute bottom-full left-0 mb-1 w-[min(100%,360px)] overflow-hidden rounded-xl gb-pop"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
            >
              {skillHits.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setDraft(`/${s.name} `)}
                  className="block w-full px-3 py-2 text-left text-[13px]"
                >
                  /{s.name}
                  {s.description ? (
                    <span className="ml-2 text-[12px]" style={{ color: "var(--muted)" }}>
                      {s.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <div className="gb-input flex items-end gap-2 px-2 py-1.5">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-full text-[20px] leading-none"
              style={{ color: "var(--muted)" }}
              title="Attach (coming soon)"
            >
              +
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={Math.min(4, Math.max(1, draft.split("\n").length))}
              placeholder={single ? `Message ${single.name}` : "Message the group"}
              className="max-h-28 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none"
              style={{ color: "var(--text)" }}
            />
            {draft.trim() ? (
              <button
                onClick={() => void send()}
                className="grid h-8 w-8 place-items-center rounded-full text-white"
                style={{ background: "#111" }}
                title="Send"
              >
                ↑
              </button>
            ) : (
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full text-white"
                style={{ background: "#111" }}
                title="Voice (coming soon)"
              >
                <MicIcon />
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  );
}
