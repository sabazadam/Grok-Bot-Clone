import { useEffect, useRef } from "react";
import type { Agent, Conversation, Message } from "@grokbot/shared";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { dayStamp, shouldStamp } from "../format";

/**
 * Official hierarchical thread: lead ↔ teammate, view-only, not in the sidebar.
 */
export function AgentDmView({
  conversation,
  host,
  onClose,
}: {
  conversation: Conversation;
  host?: Agent;
  onClose: () => void;
}) {
  const { state } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const agentById = new Map(state.agents.map((a) => [a.id, a]));
  const members = conversation.agentIds.map((id) => agentById.get(id)).filter((x): x is Agent => !!x);
  const left = host && members.find((m) => m.id === host.id) ? host : members[0];
  const right = members.find((m) => m.id !== left?.id) ?? members[1];
  const messages = state.messages[conversation.id] ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <header className="flex items-center justify-center gap-3 px-5 py-3">
        {left && <Avatar agent={left} size={28} />}
        <DoubleArrow />
        {right && <Avatar agent={right} size={28} />}
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {messages.length === 0 && (
          <p className="py-16 text-center text-[14px]" style={{ color: "var(--muted)" }}>
            No messages in this thread yet.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={m.id}>
            {shouldStamp(messages[i - 1]?.createdAt, m.createdAt) && <div className="gb-stamp">{dayStamp(m.createdAt)}</div>}
            <DmBubble message={m} agent={m.sender.kind === "agent" ? agentById.get(m.sender.agentId) : undefined} />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <footer className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid var(--hairline)" }}>
        <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--muted)" }}>
          <LockIcon /> This chat is view-only
        </span>
        <button onClick={onClose} className="rounded-full px-4 py-1.5 text-[13px] font-medium" style={{ background: "var(--surface)" }}>
          Close Chat
        </button>
      </footer>
    </section>
  );
}

function DoubleArrow() {
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" fill="none" aria-hidden>
      <path d="M7 1.5 1.5 6 7 10.5" stroke="#9a9aa0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 1.5 26.5 6 21 10.5" stroke="#9a9aa0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 6h20" stroke="#9a9aa0" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DmBubble({ message, agent }: { message: Message; agent?: Agent }) {
  if (message.kind === "activity" || message.kind === "error") {
    return (
      <p className="my-2 text-center text-[12px]" style={{ color: "var(--muted)" }}>
        {message.text}
      </p>
    );
  }
  return (
    <div className="my-3">
      {agent && (
        <div className="mb-1 flex items-center gap-2">
          <Avatar agent={agent} size={18} />
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            {agent.name}
          </span>
        </div>
      )}
      <div
        className="max-w-[520px] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.45] whitespace-pre-wrap"
        style={{ background: "var(--bubble)" }}
      >
        {message.text}
      </div>
    </div>
  );
}
