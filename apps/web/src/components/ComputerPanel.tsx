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

  const active = state.agents.find((a) => a.id === activeId);
  const computer = active?.computer;
  const live = active ? state.liveSteps[active.id] : undefined;

  const vncUrl = useMemo(() => {
    if (!computer?.novncPort || computer.state !== "running") return null;
    const params = new URLSearchParams({
      autoconnect: "1",
      resize: "scale",
      reconnect: "1",
    });
    if (!takeover) params.set("view_only", "1");
    return `http://127.0.0.1:${computer.novncPort}/vnc.html?${params.toString()}`;
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

  return (
    <aside className="flex h-full w-[46%] min-w-[420px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-900">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        {agents.length > 1 ? (
          <select
            value={activeId ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
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
            <span className="text-xs font-semibold text-neutral-200">{active.name}'s computer</span>
          </div>
        )}
        <span className="flex-1 truncate text-[11px] text-neutral-500">
          {active.status === "working" && live ? live.caption : STATUS_LABELS[active.status]}
        </span>
        <button
          onClick={() => setTakeover((v) => !v)}
          disabled={!vncUrl}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
            takeover ? "bg-orange-600 text-white" : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
          } disabled:opacity-40`}
          title="Take manual control (for passwords, 2FA, CAPTCHAs). The agent pauses while you drive."
        >
          {takeover ? "Hand back" : "Take over"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800"
        >
          ✕
        </button>
      </header>

      {takeover && (
        <div className="border-b border-orange-900/50 bg-orange-950/40 px-3 py-1.5 text-[11px] text-orange-300">
          You have manual control. Type passwords or 2FA codes directly — then "Hand back".
        </div>
      )}

      <div className="relative flex-1 bg-black">
        {vncUrl ? (
          <iframe key={vncUrl} src={vncUrl} className="absolute inset-0 h-full w-full" title="Agent computer" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
            <p className="text-sm">
              {computer?.state === "stopped" ? "This computer is stopped." : "This computer isn't running yet."}
            </p>
            <button
              disabled={busy}
              onClick={() => void computerAction("start")}
              className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? "Starting…" : "Start computer"}
            </button>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
        <button
          disabled={busy || computer?.state !== "running"}
          onClick={() => void computerAction("restart")}
          className="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          Restart
        </button>
        <button
          disabled={busy || computer?.state !== "running"}
          onClick={() => void computerAction("stop")}
          className="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          Stop
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-neutral-600">
          {computer?.state === "running" ? `noVNC :${computer.novncPort}` : "isolated Linux OS · files persist"}
        </span>
      </footer>
    </aside>
  );
}
