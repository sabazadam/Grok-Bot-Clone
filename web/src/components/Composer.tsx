import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../types';

interface Props {
  agent: Agent | null;
  onSend: (content: string) => void;
  onStop: () => void;
}

export default function Composer({ agent, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const disabled = agent === null;
  const working = agent?.status === 'working';

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const submit = () => {
    const content = text.trim();
    if (!content || disabled) return;
    onSend(content);
    setText('');
  };

  return (
    <div className="composer">
      <textarea
        ref={areaRef}
        rows={1}
        value={text}
        disabled={disabled}
        placeholder={agent ? `Message ${agent.name}…` : 'Select an agent to start chatting'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-actions">
        {working && (
          <button className="btn stop" onClick={onStop} title="Interrupt the current run">
            Stop
          </button>
        )}
        <button
          className="btn primary send"
          onClick={submit}
          disabled={disabled || text.trim() === ''}
        >
          Send
        </button>
      </div>
    </div>
  );
}
