import { useEffect, useState } from "react";
import type { Agent, MemoryEntry, Routine, Skill } from "@grokbot/shared";
import { PROVIDER_LABELS } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import { Avatar, STATUS_LABELS } from "./Avatar";

export function ProfileDrawer({ agent, onClose, onEdit }: { agent: Agent; onClose: () => void; onEdit: () => void }) {
  const { refreshAgents, selectConversation } = useStore();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [skills, setSkills] = useState<(Skill & { enabled: boolean })[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillBody, setNewSkillBody] = useState("");
  const [newRoutineName, setNewRoutineName] = useState("");
  const [newRoutinePrompt, setNewRoutinePrompt] = useState("");
  const [newRoutineSchedule, setNewRoutineSchedule] = useState("every morning");

  async function reloadExtras() {
    const [s, r] = await Promise.all([api.agentSkills(agent.id), api.routines(agent.id)]);
    setSkills(s);
    setRoutines(r);
  }

  useEffect(() => {
    void api.memories(agent.id).then(setMemories);
    void reloadExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const card = { background: "var(--surface)", border: "1px solid var(--border)" } as const;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-[380px] flex-col overflow-y-auto p-5 gb-pop"
        style={{ background: "var(--bg)", borderLeft: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <Avatar agent={agent} size={56} />
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>{agent.name}</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{agent.roleTitle || "Agent"}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>{STATUS_LABELS[agent.status]}</p>
          </div>
        </div>

        <div className="mb-4 rounded-xl p-3 text-xs" style={card}>
          <div className="mb-1 flex justify-between">
            <span style={{ color: "var(--muted)" }}>Model</span>
            <span style={{ color: "var(--text)" }}>{PROVIDER_LABELS[agent.provider]} · {agent.model}</span>
          </div>
          <div className="mb-1 flex justify-between">
            <span style={{ color: "var(--muted)" }}>Team lead</span>
            <span style={{ color: "var(--text)" }}>{agent.isTeamLead ? "owns unmentioned group work" : "member"}</span>
          </div>
          <div className="mb-1 flex justify-between">
            <span style={{ color: "var(--muted)" }}>Collaboration</span>
            <span style={{ color: "var(--text)" }}>{agent.collaborationEnabled ? "may message other agents" : "solo only"}</span>
          </div>
          <div className="mb-1 flex justify-between">
            <span style={{ color: "var(--muted)" }}>Stealth browsing</span>
            <span style={{ color: "var(--text)" }}>{agent.stealthBrowsing ? "on (anti-fingerprint)" : "off"}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--muted)" }}>Computer</span>
            <span style={{ color: "var(--text)" }}>
              {agent.computer?.state === "running" ? `running (noVNC :${agent.computer.novncPort})` : (agent.computer?.state ?? "none")}
            </span>
          </div>
        </div>

        {agent.instructions && (
          <>
            <h3 className="mb-1 text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--muted)" }}>Instructions</h3>
            <p className="mb-4 rounded-xl p-3 text-sm whitespace-pre-wrap" style={{ ...card, color: "var(--text)" }}>{agent.instructions}</p>
          </>
        )}

        <h3 className="mb-1 text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--muted)" }}>Skills</h3>
        <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
          Type /Name in chat to run an enabled skill. Same idea as Grok Bot.
        </p>
        <div className="mb-3 space-y-1.5">
          {skills.length === 0 && <p className="text-xs" style={{ color: "var(--muted)" }}>No skills yet. Save one below or ask the agent to save_skill.</p>}
          {skills.map((s) => (
            <label key={s.id} className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={card}>
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={async (e) => {
                  await api.setAgentSkill(agent.id, s.id, e.target.checked);
                  await reloadExtras();
                }}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span className="flex-1" style={{ color: "var(--text)" }}>
                <span className="font-semibold">/{s.name}</span>
                {s.description ? <span style={{ color: "var(--muted)" }}> — {s.description}</span> : null}
              </span>
              <button
                onClick={async () => {
                  await api.deleteSkill(s.id);
                  await reloadExtras();
                }}
                style={{ color: "var(--muted)" }}
                title="Delete skill"
              >
                ✕
              </button>
            </label>
          ))}
        </div>
        <div className="mb-4 space-y-1.5">
          <input
            value={newSkillName}
            onChange={(e) => setNewSkillName(e.target.value)}
            placeholder="Skill name"
            className="w-full rounded-lg px-3 py-1.5 text-xs"
            style={card}
          />
          <textarea
            value={newSkillBody}
            onChange={(e) => setNewSkillBody(e.target.value)}
            placeholder="Steps, output, what needs approval"
            rows={2}
            className="w-full resize-y rounded-lg px-3 py-1.5 text-xs"
            style={card}
          />
          <button
            disabled={!newSkillName.trim() || !newSkillBody.trim()}
            onClick={async () => {
              await api.createSkill({
                name: newSkillName.trim(),
                instructions: newSkillBody.trim(),
                enableForAgentId: agent.id,
              });
              setNewSkillName("");
              setNewSkillBody("");
              await reloadExtras();
            }}
            className="rounded-full px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            Save skill
          </button>
        </div>

        <h3 className="mb-1 text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--muted)" }}>Routines</h3>
        <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
          Repeating work on this agent’s computer. Examples: every morning, every evening, weekdays at 8am, every 30 minutes until 4 AM. Test run does real work.
        </p>
        <div className="mb-3 space-y-1.5">
          {routines.length === 0 && <p className="text-xs" style={{ color: "var(--muted)" }}>None scheduled.</p>}
          {routines.map((r) => (
            <div key={r.id} className="rounded-lg px-3 py-2 text-xs" style={card}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold" style={{ color: "var(--text)" }}>{r.name}</span>
                <span style={{ color: "var(--muted)" }}>{r.scheduleLabel || `every ${r.intervalMinutes}m`}</span>
              </div>
              <p className="mt-1" style={{ color: "var(--text)" }}>{r.prompt}</p>
              <p className="mt-0.5" style={{ color: "var(--muted)" }}>
                next {new Date(r.nextRunAt).toLocaleString()}
                {r.timezone ? ` · ${r.timezone}` : ""}
              </p>
              <div className="mt-1.5 flex gap-2">
                <button
                  onClick={async () => {
                    await api.updateRoutine(r.id, { enabled: !r.enabled });
                    await reloadExtras();
                  }}
                  style={{ color: "var(--muted)" }}
                >
                  {r.enabled ? "Pause" : "Enable"}
                </button>
                <button
                  onClick={() => void api.runRoutine(r.id)}
                  style={{ color: "var(--muted)" }}
                >
                  Test run
                </button>
                <button
                  onClick={async () => {
                    await api.deleteRoutine(r.id);
                    await reloadExtras();
                  }}
                  style={{ color: "var(--danger)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mb-4 space-y-1.5">
          <input
            value={newRoutineName}
            onChange={(e) => setNewRoutineName(e.target.value)}
            placeholder="Routine name"
            className="w-full rounded-lg px-3 py-1.5 text-xs"
            style={card}
          />
          <textarea
            value={newRoutinePrompt}
            onChange={(e) => setNewRoutinePrompt(e.target.value)}
            placeholder="What to do each run"
            rows={2}
            className="w-full resize-y rounded-lg px-3 py-1.5 text-xs"
            style={card}
          />
          <div className="flex items-center gap-2">
            <input
              value={newRoutineSchedule}
              onChange={(e) => setNewRoutineSchedule(e.target.value)}
              placeholder="every morning"
              className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs"
              style={card}
            />
            <button
              disabled={!newRoutineName.trim() || !newRoutinePrompt.trim() || !newRoutineSchedule.trim()}
              onClick={async () => {
                await api.createRoutine({
                  agentId: agent.id,
                  name: newRoutineName.trim(),
                  prompt: newRoutinePrompt.trim(),
                  schedule: newRoutineSchedule.trim(),
                });
                setNewRoutineName("");
                setNewRoutinePrompt("");
                await reloadExtras();
              }}
              className="rounded-full px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Schedule
            </button>
          </div>
        </div>

        <h3 className="mb-1 text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--muted)" }}>Memory ({memories.length})</h3>
        <div className="mb-4 space-y-1.5">
          {memories.length === 0 && <p className="text-xs" style={{ color: "var(--muted)" }}>Nothing learned yet.</p>}
          {memories.map((m) => (
            <div key={m.id} className="group flex items-start gap-2 rounded-lg px-3 py-2" style={card}>
              <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{m.kind}</span>
              <p className="flex-1 text-xs" style={{ color: "var(--text)" }}>{m.content}</p>
              <button
                onClick={() => void api.deleteMemory(m.id).then(() => setMemories((cur) => cur.filter((x) => x.id !== m.id)))}
                className="hidden text-xs group-hover:block"
                style={{ color: "var(--muted)" }}
                title="Forget"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-auto space-y-2">
          <button onClick={onEdit} className="w-full rounded-full px-4 py-2 text-sm" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
            Edit profile
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-full px-4 py-2 text-sm"
              style={{ border: "1px solid color-mix(in srgb, var(--danger) 50%, transparent)", color: "var(--danger)" }}
            >
              Delete agent
            </button>
          ) : (
            <div className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--danger) 10%, var(--bg))", border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)" }}>
              <p className="mb-2 text-xs" style={{ color: "var(--danger)" }}>Delete {agent.name}? Its conversation and role are removed.</p>
              <label className="mb-2 flex items-center gap-2 text-xs" style={{ color: "var(--danger)" }}>
                <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
                Also erase its computer's files (volume)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await api.deleteAgent(agent.id, deleteData);
                    await refreshAgents();
                    selectConversation(null);
                    onClose();
                  }}
                  className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "var(--danger)" }}
                >
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full px-3 py-1.5 text-xs" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
