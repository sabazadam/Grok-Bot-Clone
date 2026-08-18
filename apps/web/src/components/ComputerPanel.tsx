import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import { Avatar, STATUS_LABELS } from "./Avatar";

/**
 * "Agent Computer" panel — live view of an agent's own OS via embedded noVNC.
 * View-only by default; "Take over" enables input passthrough so the user can
 * type passwords/2FA directly (the agent pauses while you drive).
 */
export function ComputerPanel({ agents, onClose }: { agents: Agent[]; onClose: () => void }) {
  const { state, refreshAgents } = useStore();
  const [activeId, setActiveId] = useState(agents[0]?.id ?? null);
  const [takeover, setTakeover] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agents.some((a) => a.id === activeId)) setActiveId(agents[0]?.id ?? null);
  }, [agents, activeId]);

  useEffect(() => {
    setTakeover(false);
    return () => {
      if (activeId) void api.setTakeover(activeId, false).catch(() => undefined);
    };
  }, [activeId]);

  const active = state.agents.find((a) => a.id === activeId);
  const computer = active?.computer;
  const live = active ? state.liveSteps[active.id] : undefined;

  const vncUrl = useMemo(() => {
    if (!computer?.novncPort || computer.state !== "running") return null;
    const params = new URLSearchParams({ autoconnect: "1", resize: "scale", reconnect: "1" });
    if (!takeover) params.set("view_only", "1");
    // Use the host the app was loaded from so this works both locally (localhost) and
    // remotely (e.g. the Mac mini's Tailscale IP when driving from a MacBook).
    const host = window.location.hostname || "127.0.0.1";
    return `http://${host}:${computer.novncPort}/vnc.html?${params.toString()}`;
  }, [computer?.novncPort, computer?.state, takeover]);

  if (!active) return null;

  async function computerAction(kind: "start" | "stop" | "restart") {
    if (!active) return;
    setBusy(true);
    try {
      if (kind === "start") await api.startComputer(active.id);
      if (kind === "stop") await api.stopComputer(active.id);
      if (kind === "restart") await api.restartComputer(active.id);
      await refreshAgents();
    } finally {
      setBusy(false);
    }
  }

  const ctlBtn = "rounded-full px-2.5 py-1 text-[11px] disabled:opacity-40";
  const ctlStyle = { border: "1px solid var(--border)", color: "var(--text)" } as const;

  return (
    <aside
      className="flex h-full w-[46%] min-w-[420px] shrink-0 flex-col"
      style={{ background: "var(--sidebar)", borderLeft: "1px solid var(--border)" }}
    >
      <header className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
        {agents.length > 1 ? (
          <select
            value={activeId ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
            className="rounded-lg px-2 py-1 text-xs"
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}'s computer
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <Avatar agent={active} size={24} showStatus={false} />
            <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
              {active.name}'s computer
            </span>
          </div>
        )}
        <span className="flex-1 truncate text-[11px]" style={{ color: "var(--muted)" }}>
          {active.status === "working" && live ? live.caption : STATUS_LABELS[active.status]}
        </span>
        <button
          onClick={() => {
            const next = !takeover;
            setTakeover(next);
            void api.setTakeover(active.id, next).catch(() => setTakeover(!next));
          }}
          disabled={!vncUrl}
          className={ctlBtn + " font-semibold"}
          style={takeover ? { background: "var(--warn)", color: "#fff" } : ctlStyle}
          title="Take manual control (passwords, 2FA, CAPTCHAs). The agent pauses while you drive."
        >
          {takeover ? "Hand back" : "Take over"}
        </button>
        <button onClick={onClose} className={ctlBtn} style={ctlStyle}>
          ✕
        </button>
      </header>

      {takeover && (
        <div
          className="px-3 py-1.5 text-[11px]"
          style={{ background: "color-mix(in srgb, var(--warn) 15%, var(--bg))", color: "var(--warn)", borderBottom: "1px solid var(--border)" }}
        >
          You have manual control. Type passwords or 2FA codes directly — then "Hand back".
        </div>
      )}

      <div className="relative flex-1 bg-black">
        {vncUrl ? (
          <iframe key={vncUrl} src={vncUrl} className="absolute inset-0 h-full w-full" title="Agent computer" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3" style={{ color: "var(--muted)" }}>
            <p className="text-sm">{computer?.state === "stopped" ? "This computer is stopped." : "This computer isn't running yet."}</p>
            <button
              disabled={busy}
              onClick={() => void computerAction("start")}
              className="rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {busy ? "Starting…" : "Start computer"}
            </button>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--border)" }}>
        <button disabled={busy || computer?.state !== "running"} onClick={() => void computerAction("restart")} className={ctlBtn} style={ctlStyle}>
          Restart
        </button>
        <button disabled={busy || computer?.state !== "running"} onClick={() => void computerAction("stop")} className={ctlBtn} style={ctlStyle}>
          Stop
        </button>
        <span className="flex-1" />
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          {computer?.state === "running" ? `noVNC :${computer.novncPort}` : "isolated Linux OS · files persist"}
        </span>
      </footer>
    </aside>
  );
}
