import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc/lib/rfb';
import { api, wsUrl } from '../api';
import type { Agent } from '../types';

interface Props {
  agent: Agent;
  onCollapse: () => void;
}

type ConnState = 'connecting' | 'connected' | 'disconnected';

export default function ComputerPanel({ agent, onCollapse }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [conn, setConn] = useState<ConnState>('disconnected');
  const [mode, setMode] = useState<'watch' | 'control'>('watch');
  const modeRef = useRef(mode);
  const [restarting, setRestarting] = useState(false);

  // Default back to watch mode when switching agents.
  useEffect(() => {
    setMode('watch');
  }, [agent.id]);

  useEffect(() => {
    modeRef.current = mode;
    if (rfbRef.current) rfbRef.current.viewOnly = mode === 'watch';
  }, [mode]);

  const running = agent.computerState === 'running';

  // Connect while mounted (panel open) and the computer is running;
  // retry with backoff on drops.
  useEffect(() => {
    if (!running) {
      setConn('disconnected');
      return;
    }
    let disposed = false;
    let attempt = 0;
    let timer: number | undefined;

    const connect = () => {
      if (disposed || !viewportRef.current) return;
      setConn('connecting');
      let rfb: RFB;
      try {
        rfb = new RFB(viewportRef.current, wsUrl(`/api/agents/${agent.id}/vnc`));
      } catch {
        scheduleRetry();
        return;
      }
      rfb.viewOnly = modeRef.current === 'watch';
      rfb.scaleViewport = true;
      rfb.clipViewport = true;
      rfb.background = 'transparent';
      rfbRef.current = rfb;

      rfb.addEventListener('connect', () => {
        attempt = 0;
        setConn('connected');
      });
      rfb.addEventListener('disconnect', () => {
        rfbRef.current = null;
        if (disposed) return;
        setConn('disconnected');
        scheduleRetry();
      });
    };

    const scheduleRetry = () => {
      const delay = Math.min(10000, 800 * 2 ** attempt);
      attempt = Math.min(attempt + 1, 5);
      timer = window.setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      try {
        rfbRef.current?.disconnect();
      } catch {
        // already down
      }
      rfbRef.current = null;
      setConn('disconnected');
    };
  }, [agent.id, running]);

  const restart = async () => {
    if (
      !window.confirm(
        `Restart ${agent.name}'s computer? Open apps will close; files on its disk are kept.`,
      )
    )
      return;
    setRestarting(true);
    try {
      await api.restartComputer(agent.id);
    } catch (err) {
      window.alert(`Could not restart: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestarting(false);
    }
  };

  let overlay: string | null = null;
  if (agent.computerState === 'starting') overlay = 'Computer is starting…';
  else if (agent.computerState === 'stopped') overlay = 'Computer is off';
  else if (agent.computerState === 'error') overlay = 'Computer error — try Restart';
  else if (conn !== 'connected')
    overlay = conn === 'connecting' ? 'Connecting…' : 'Disconnected — retrying';

  return (
    <aside className="computer-panel">
      <header className="panel-header">
        <div className="panel-title">
          <span className="panel-title-main">Agent computer</span>
          <span className="panel-title-sub">{agent.name}</span>
        </div>
        <button className="icon-btn" title="Collapse panel" onClick={onCollapse}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </header>

      <div className="panel-controls">
        <div className="segmented" role="tablist" aria-label="Screen mode">
          <button
            className={mode === 'watch' ? 'active' : ''}
            onClick={() => setMode('watch')}
            title="View only"
          >
            Watch
          </button>
          <button
            className={mode === 'control' ? 'active' : ''}
            onClick={() => setMode('control')}
            title="Send your mouse and keyboard to the agent's computer"
          >
            Take control
          </button>
        </div>
        <button className="btn subtle" onClick={restart} disabled={restarting}>
          {restarting ? 'Restarting…' : 'Restart'}
        </button>
      </div>

      <div className={`vnc-viewport${mode === 'control' ? ' controlling' : ''}`}>
        <div className="vnc-target" ref={viewportRef} />
        {overlay && (
          <div className="vnc-overlay">
            <span className={`vnc-overlay-dot ${agent.computerState}`} />
            <span>{overlay}</span>
          </div>
        )}
      </div>

      {mode === 'control' && conn === 'connected' && (
        <div className="control-note">You are controlling this computer</div>
      )}
    </aside>
  );
}
