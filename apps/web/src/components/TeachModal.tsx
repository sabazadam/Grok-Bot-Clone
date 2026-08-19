import { useEffect, useState } from "react";
import type { Agent } from "@grokbot/shared";
import { api, type TeachSession } from "../api";
import { useStore } from "../store";

export function TeachModal({
  agent,
  onClose,
  onOpenComputer,
}: {
  agent: Agent;
  onClose: () => void;
  onOpenComputer: () => void;
}) {
  const { refreshAgents } = useStore();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [session, setSession] = useState<TeachSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const card = { background: "var(--surface)", border: "1px solid var(--border)" } as const;

  useEffect(() => {
    void api
      .teachSession(agent.id)
      .then((r) => {
        if (r.session) {
          setSession(r.session);
          setName(r.session.name);
          setNotes(r.session.notes);
        }
      })
      .catch(() => undefined);
  }, [agent.id]);

  useEffect(() => {
    if (!session) return;
    const tick = () => setElapsed(Math.max(0, Date.now() - session.startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      void api
        .teachSession(agent.id)
        .then((r) => setSession(r.session))
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(id);
  }, [agent.id, session?.startedAt]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.teachStart(agent.id, name.trim() || "Taught task", notes.trim());
      setSession(next);
      await refreshAgents();
      onOpenComputer();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop(save: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.teachStop(agent.id, save);
      setSession(null);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000)
    .toString()
    .padStart(2, "0");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl p-5 gb-pop"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-bold">Teach a task</h2>
        <p className="mb-4 text-[13px]" style={{ color: "var(--muted)" }}>
          Take over {agent.name}'s computer and demonstrate the path (up to 10 minutes). We save a skill from the
          recording so anyone can run it with /Name.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Skill name, e.g. Weekly account health"
          disabled={!!session}
          className="mb-2 w-full rounded-xl px-3 py-2 text-sm"
          style={card}
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What to pay attention to, inputs, and the expected end state"
          disabled={!!session}
          rows={3}
          className="mb-3 w-full resize-y rounded-xl px-3 py-2 text-sm"
          style={card}
        />
        {session && (
          <div className="mb-3 rounded-xl px-3 py-2 text-[13px]" style={{ background: "color-mix(in srgb, var(--wait) 12%, var(--bg))" }}>
            <div className="font-semibold" style={{ color: "var(--wait)" }}>
              Recording · {minutes}:{seconds}
            </div>
            <div style={{ color: "var(--muted)" }}>
              {session.shots.length} key frame{session.shots.length === 1 ? "" : "s"} captured. Drive the screen, then
              save.
            </div>
          </div>
        )}
        {error && (
          <p className="mb-2 text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {!session ? (
            <>
              <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
                Cancel
              </button>
              <button
                disabled={busy || !name.trim()}
                onClick={() => void start()}
                className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
                style={{ background: "var(--accent)" }}
              >
                {busy ? "Starting…" : "Start recording"}
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() => void stop(false)}
                className="rounded-full px-3 py-1.5 text-[13px]"
                style={{ color: "var(--danger)" }}
              >
                Discard
              </button>
              <button
                disabled={busy}
                onClick={() => void stop(true)}
                className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-white"
                style={{ background: "var(--accent)" }}
              >
                Save skill
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
