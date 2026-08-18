import { useState } from 'react';
import type { Activity, Message } from '../types';

const KIND_GLYPH: Record<string, string> = {
  screenshot: '▣',
  click: '⊙',
  double_click: '◎',
  right_click: '◑',
  move: '→',
  scroll: '↕',
  type: '⌨',
  key: '⌘',
  wait: '◔',
  exec: '❯',
  remember: '✎',
  thought: '∙',
};

function parseActivity(content: string): Activity {
  try {
    const parsed = JSON.parse(content) as Activity;
    if (parsed && typeof parsed.summary === 'string' && typeof parsed.kind === 'string') {
      return parsed;
    }
  } catch {
    // fall through to raw content
  }
  return { kind: 'thought', summary: content };
}

function timeTitle(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function ActivityLine({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const activity = parseActivity(message.content);
  const glyph = KIND_GLYPH[activity.kind] ?? '·';
  const expandable = Boolean(activity.detail);

  return (
    <div className="activity-block" title={timeTitle(message.createdAt)}>
      <div
        className={`activity${expandable ? ' expandable' : ''}`}
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        role={expandable ? 'button' : undefined}
      >
        <span className={`act-glyph kind-${activity.kind}`}>{glyph}</span>
        <span className="act-kind">{activity.kind.replace('_', ' ')}</span>
        <span className="act-summary">{activity.summary}</span>
        {expandable && <span className="act-caret">{open ? '−' : '+'}</span>}
      </div>
      {open && activity.detail && <pre className="act-detail">{activity.detail}</pre>}
    </div>
  );
}

export default function MessageItem({ message }: { message: Message }) {
  switch (message.role) {
    case 'user':
      return (
        <div className="msg-row from-user">
          <div className="bubble user" title={timeTitle(message.createdAt)}>
            {message.content}
          </div>
        </div>
      );

    case 'assistant':
      return (
        <div className="msg-row from-agent">
          <div className="bubble assistant" title={timeTitle(message.createdAt)}>
            {message.content}
          </div>
        </div>
      );

    case 'peer_in':
      return (
        <div className="msg-row from-agent">
          <div className="peer-wrap">
            <span className="peer-label">from {message.senderName ?? 'agent'}</span>
            <div className="bubble peer" title={timeTitle(message.createdAt)}>
              {message.content}
            </div>
          </div>
        </div>
      );

    case 'peer_out': {
      const toName =
        typeof message.meta?.toName === 'string' ? (message.meta.toName as string) : 'agent';
      return (
        <div className="msg-row from-agent">
          <div className="peer-wrap">
            <span className="peer-label">to {toName}</span>
            <div className="bubble peer out" title={timeTitle(message.createdAt)}>
              {message.content}
            </div>
          </div>
        </div>
      );
    }

    case 'system':
      return (
        <div className="msg-system" title={timeTitle(message.createdAt)}>
          {message.content}
        </div>
      );

    case 'activity':
      return <ActivityLine message={message} />;
  }
}
