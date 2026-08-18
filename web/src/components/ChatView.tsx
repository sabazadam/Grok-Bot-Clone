import { useEffect, useRef } from 'react';
import type { Agent, Message } from '../types';
import MessageItem from './MessageItem';
import Composer from './Composer';

interface Props {
  agent: Agent;
  messages: Message[];
  threadLoaded: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

export default function ChatView({
  agent,
  messages,
  threadLoaded,
  onSend,
  onStop,
  onEdit,
  onDelete,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Reset scroll pinning when switching threads.
  useEffect(() => {
    stickToBottom.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.id]);

  // Auto-scroll on new messages unless the user has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <span className="avatar lg" style={{ background: agent.color }}>
          {agent.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="chat-header-text">
          <div className="chat-header-name-row">
            <h2>{agent.name}</h2>
            <span className="model-chip" title="Provider / model">
              {agent.provider}/{agent.model}
            </span>
          </div>
          <div className="chat-header-title">{agent.title || 'No title'}</div>
        </div>
        <div className="chat-header-actions">
          <button className="icon-btn" title="Edit agent" onClick={onEdit}>
            <PencilIcon />
          </button>
          <button className="icon-btn danger" title="Delete agent" onClick={onDelete}>
            <TrashIcon />
          </button>
        </div>
      </header>

      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {!threadLoaded ? (
          <div className="thread-hint">Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="thread-hint">
            <p className="thread-hint-title">No messages yet</p>
            <p>
              Say hello — ask {agent.name} to research something, open a site on its computer,
              or give it a standing rule to follow.
            </p>
          </div>
        ) : (
          messages.map((m) => <MessageItem key={m.id} message={m} />)
        )}
      </div>

      <Composer agent={agent} onSend={onSend} onStop={onStop} />
    </section>
  );
}
