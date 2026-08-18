import type { Agent, AgentStatus, ComputerState } from '../types';

interface Props {
  agents: Agent[];
  selectedId: string | null;
  unread: Record<string, boolean>;
  onSelect: (id: string) => void;
  onNewAgent: () => void;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  needs_attention: 'Needs attention',
};

function computerBadge(state: ComputerState): string | null {
  switch (state) {
    case 'starting':
      return 'booting…';
    case 'stopped':
      return 'off';
    case 'error':
      return 'error';
    case 'running':
      return null;
  }
}

export default function Sidebar({ agents, selectedId, unread, onSelect, onNewAgent }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-label">Agents</div>
      <nav className="roster">
        {agents.map((agent) => {
          const badge = computerBadge(agent.computerState);
          return (
            <button
              key={agent.id}
              className={`roster-item${agent.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(agent.id)}
            >
              <span className="avatar" style={{ background: agent.color }}>
                {agent.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="roster-main">
                <span className="roster-name-row">
                  <span className="roster-name">{agent.name}</span>
                  <span
                    className={`status-dot ${agent.status}`}
                    title={STATUS_LABEL[agent.status]}
                  />
                </span>
                <span className="roster-title">{agent.title || agent.model}</span>
              </span>
              <span className="roster-right">
                {badge && <span className={`comp-badge ${agent.computerState}`}>{badge}</span>}
                {unread[agent.id] && <span className="unread-dot" title="New messages" />}
              </span>
            </button>
          );
        })}
        {agents.length === 0 && <div className="roster-empty">No agents yet</div>}
      </nav>
      <div className="sidebar-footer">
        <button className="btn new-agent" onClick={onNewAgent}>
          <span className="plus">+</span> New agent
        </button>
      </div>
    </aside>
  );
}
