import { useEffect, useState } from "react";
import type { Agent, Routine } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import { Avatar } from "./Avatar";

/**
 * Official right rail: a small live screen + routines.
 */
export function WorkspacePanel({
  agent,
  onExpandComputer,
  onCreateRoutine,
  onTeach,
  onCollapse,
}: {
  agent: Agent;
  onExpandComputer: () => void;
  onCreateRoutine: () => void;
  onTeach: () => void;
  onCollapse: () => void;
}) {
  const { state } = useStore();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const live = state.liveSteps[agent.id];
  const shot = live?.screenshotUrl;
  const running = agent.computer?.state === "running";

  useEffect(() => {
    void api.routines(agent.id).then(setRoutines).catch(() => setRoutines([]));
  }, [agent.id, state.routines]);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col" style={{ background: "var(--bg)", borderLeft: "1px solid var(--hairline)" }}>
      <header className="flex items-center justify-end gap-1 px-3 py-3">
        <button onClick={onCollapse} className="grid h-8 w-8 place-items-center text-[14px]" style={{ color: "var(--muted)" }} title="Hide panel">
          ≫
        </button>
      </header>

      <div className="px-4">
        <p className="mb-2 text-[13px] font-medium" style={{ color: "var(--text)" }}>
          {agent.name}'s screen
        </p>
        <button
          onClick={onExpandComputer}
          className="relative block w-full overflow-hidden rounded-2xl"
          style={{ background: "#d8d8de", aspectRatio: "16 / 10" }}
        >
          {shot ? (
            <img src={shot} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #d4d5da 0%, #c2c3c8 100%)" }}>
              <div className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center gap-2" style={{ background: "rgba(42,42,48,0.62)" }}>
                <span className="h-3.5 w-3.5 rounded-full" style={{ background: "#7aa2ff" }} />
                <span className="h-3.5 w-3.5 rounded-sm" style={{ background: "#9ad07a" }} />
                <span className="h-3.5 w-3.5 rounded-sm" style={{ background: "#e6c36a" }} />
              </div>
            </div>
          )}
          {!running && (
            <div className="absolute inset-0 grid place-items-center text-[12px]" style={{ color: "#555", background: "rgba(255,255,255,0.25)" }}>
              Offline
            </div>
          )}
        </button>
      </div>

      <div className="mt-6 flex flex-1 flex-col overflow-y-auto px-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
            Routines
          </span>
          <button
            onClick={onCreateRoutine}
            title="Add routine"
            className="grid h-6 w-6 place-items-center rounded-full text-[16px] leading-none"
            style={{ color: "var(--muted)" }}
          >
            +
          </button>
        </div>
        {routines.length === 0 ? (
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Recurring tasks this Bot runs on a schedule. Add one with +.
          </p>
        ) : (
          <div className="space-y-1.5">
            {routines.map((r) => (
              <button
                key={r.id}
                onClick={onCreateRoutine}
                className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left"
                style={{ background: "var(--surface)" }}
                title={r.enabled ? "Enabled" : "Paused"}
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: r.enabled ? "var(--ok)" : "var(--muted)" }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {r.name}
                  </span>
                  <span className="block text-[11px]" style={{ color: "var(--muted)" }}>
                    {r.scheduleLabel || `every ${r.intervalMinutes}m`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onTeach}
          className="mt-3 rounded-full px-4 py-2 text-[13px] font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
        >
          Teach a task
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-3" style={{ color: "var(--muted)" }}>
        <Avatar agent={agent} size={18} />
        <span className="truncate text-[11px]">{agent.roleTitle || "Agent"}</span>
      </div>
    </aside>
  );
}
