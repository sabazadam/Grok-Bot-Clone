import { useEffect, useState } from "react";
import type { Agent, Provider } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];

const ROLE_EXAMPLES = ["Researcher", "Chief of Staff", "Talent Scout", "Expense Manager", "Bug Reporter", "Trip Planner"];

export function AgentModal({
  existing,
  onClose,
}: {
  existing?: Agent;
  onClose: () => void;
}) {
  const { state, refreshAgents, selectConversation } = useStore();
  const providers = state.config?.providers ?? [];

  const [name, setName] = useState(existing?.name ?? "");
  const [roleTitle, setRoleTitle] = useState(existing?.roleTitle ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [avatarColor, setAvatarColor] = useState(existing?.avatarColor ?? COLORS[Math.floor(Math.random() * COLORS.length)]!);
  const [provider, setProvider] = useState<Provider>(existing?.provider ?? (providers.find((p) => p.hasKey)?.id || "anthropic"));
  const [model, setModel] = useState(existing?.model ?? "");
  const [collaborationEnabled, setCollaborationEnabled] = useState(existing?.collaborationEnabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existing) {
      const def = providers.find((p) => p.id === provider)?.defaultModel ?? "";
      setModel(def);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), roleTitle: roleTitle.trim(), instructions, avatarColor, provider, model: model.trim(), collaborationEnabled };
      if (existing) {
        await api.updateAgent(existing.id, body);
        await refreshAgents();
      } else {
        await api.createAgent(body);
        await refreshAgents();
        const convs = await api.conversations();
        const direct = convs.find((c) => c.kind === "direct" && c.title === body.name);
        if (direct) selectConversation(direct.id);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedProvider = providers.find((p) => p.id === provider);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-neutral-100">{existing ? `Edit ${existing.name}` : "New agent"}</h2>

        <label className="mb-1 block text-xs font-semibold text-neutral-400">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Nova"
          className="mb-3 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-sky-600 focus:outline-none"
        />

        <label className="mb-1 block text-xs font-semibold text-neutral-400">Job / role</label>
        <input
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          placeholder={`e.g. ${ROLE_EXAMPLES[Math.floor(Math.random() * ROLE_EXAMPLES.length)]}`}
          className="mb-3 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-sky-600 focus:outline-none"
        />

        <label className="mb-1 block text-xs font-semibold text-neutral-400">
          Instructions & boundaries <span className="font-normal text-neutral-500">(what it owns, how you like work done, what needs approval)</span>
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="You own weekly competitor research. Save reports to workspace/reports. Never send emails without approval."
          className="mb-3 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-sky-600 focus:outline-none"
        />

        <div className="mb-3 flex items-center gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-400">Avatar</label>
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAvatarColor(c)}
                  className={`h-6 w-6 rounded-full ${avatarColor === c ? "ring-2 ring-white" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-400">AI provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.hasKey ? "" : " (no API key)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-400">Model</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-sky-600 focus:outline-none"
            />
          </div>
        </div>
        {selectedProvider && !selectedProvider.hasKey && (
          <p className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
            No API key configured for {selectedProvider.label}. Add it to your .env and restart the server.
          </p>
        )}

        <label className="mb-4 flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={collaborationEnabled}
            onChange={(e) => setCollaborationEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          May message other agents (collaboration)
        </label>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim() || !model.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {busy ? "Saving…" : existing ? "Save" : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroupModal({ onClose }: { onClose: () => void }) {
  const { state, selectConversation, dispatch } = useStore();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const conv = await api.createGroup(title.trim(), selected);
      dispatch({ type: "event", event: { type: "conversation_updated", conversation: conv } });
      selectConversation(conv.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-neutral-100">New group chat</h2>
        <label className="mb-1 block text-xs font-semibold text-neutral-400">Group name</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Website Launch"
          className="mb-3 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-sky-600 focus:outline-none"
        />
        <label className="mb-1 block text-xs font-semibold text-neutral-400">Agents</label>
        <div className="mb-4 max-h-48 space-y-1 overflow-y-auto">
          {state.agents.map((a) => (
            <label key={a.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800">
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                onChange={(e) =>
                  setSelected((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))
                }
                className="h-4 w-4"
              />
              {a.name} <span className="text-xs text-neutral-500">· {a.roleTitle || "Agent"}</span>
            </label>
          ))}
        </div>
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={busy || !title.trim() || selected.length === 0}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
