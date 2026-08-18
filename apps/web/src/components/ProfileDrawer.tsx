import { useEffect, useState } from "react";
import type { Agent, MemoryEntry } from "@grokbot/shared";
import { PROVIDER_LABELS } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";
import { Avatar, STATUS_LABELS } from "./Avatar";

export function ProfileDrawer({
  agent,
  onClose,
  onEdit,
}: {
  agent: Agent;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { refreshAgents, selectConversation } = useStore();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteData, setDeleteData] = useState(false);

  useEffect(() => {
    void api.memories(agent.id).then(setMemories);
  }, [agent.id]);

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-[380px] flex-col overflow-y-auto border-l border-neutral-700 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <Avatar agent={agent} size={56} />
          <div>
            <h2 className="text-lg font-bold text-neutral-100">{agent.name}</h2>
            <p className="text-sm text-neutral-400">{agent.roleTitle || "Agent"}</p>
            <p className="text-xs text-neutral-500">{STATUS_LABELS[agent.status]}</p>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
          <div className="mb-1 flex justify-between">
            <span>Model</span>
            <span className="text-neutral-200">
              {PROVIDER_LABELS[agent.provider]} · {agent.model}
            </span>
          </div>
          <div className="mb-1 flex justify-between">
            <span>Collaboration</span>
            <span className="text-neutral-200">{agent.collaborationEnabled ? "may message other agents" : "solo only"}</span>
          </div>
          <div className="flex justify-between">
            <span>Computer</span>
            <span className="text-neutral-200">
              {agent.computer?.state === "running" ? `running (noVNC :${agent.computer.novncPort})` : (agent.computer?.state ?? "none")}
            </span>
          </div>
        </div>

        {agent.instructions && (
          <>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Instructions</h3>
            <p className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm whitespace-pre-wrap text-neutral-300">
              {agent.instructions}
            </p>
          </>
        )}

        <h3 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          Memory ({memories.length})
        </h3>
        <div className="mb-4 space-y-1.5">
          {memories.length === 0 && <p className="text-xs text-neutral-600">Nothing learned yet.</p>}
          {memories.map((m) => (
            <div key={m.id} className="group flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{m.kind}</span>
              <p className="flex-1 text-xs text-neutral-300">{m.content}</p>
              <button
                onClick={() => {
                  void api.deleteMemory(m.id).then(() => setMemories((cur) => cur.filter((x) => x.id !== m.id)));
                }}
                className="hidden text-xs text-neutral-600 hover:text-red-400 group-hover:block"
                title="Forget"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-auto space-y-2">
          <button
            onClick={onEdit}
            className="w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Edit profile
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-lg border border-red-900/70 px-4 py-2 text-sm text-red-400 hover:bg-red-950/50"
            >
              Delete agent
            </button>
          ) : (
            <div className="rounded-xl border border-red-900/70 bg-red-950/30 p-3">
              <p className="mb-2 text-xs text-red-300">Delete {agent.name}? Its conversation and role are removed.</p>
              <label className="mb-2 flex items-center gap-2 text-xs text-red-200">
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
                  className="flex-1 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                >
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
