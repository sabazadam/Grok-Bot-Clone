import { useEffect, useState } from "react";
import type { Agent, Provider } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";

const COLORS = ["#0a84ff", "#5e5ce6", "#30d158", "#ff9f0a", "#ff375f", "#ff2d55", "#bf5af2", "#64d2ff"];
const ROLE_EXAMPLES = ["Researcher", "Chief of Staff", "Talent Scout", "Expense Manager", "Bug Reporter", "Trip Planner"];

const field =
  "w-full rounded-xl px-3 py-2 text-sm focus:outline-none";
const fieldStyle = { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" } as const;
const label = "mb-1 block text-xs font-semibold";
const labelStyle = { color: "var(--muted)" } as const;

export function AgentModal({ existing, onClose }: { existing?: Agent; onClose: () => void }) {
  const { state, refreshAgents, selectConversation } = useStore();
  const providers = state.config?.providers ?? [];

  const [name, setName] = useState(existing?.name ?? "");
  const [roleTitle, setRoleTitle] = useState(existing?.roleTitle ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [avatarColor, setAvatarColor] = useState(existing?.avatarColor ?? COLORS[Math.floor(Math.random() * COLORS.length)]!);
  const [provider, setProvider] = useState<Provider>(existing?.provider ?? (providers.find((p) => p.hasKey)?.id || "anthropic"));
  const [model, setModel] = useState(existing?.model ?? "");
  const [collaborationEnabled, setCollaborationEnabled] = useState(existing?.collaborationEnabled ?? true);
  const [stealthBrowsing, setStealthBrowsing] = useState(existing?.stealthBrowsing ?? true);
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
      const body = { name: name.trim(), roleTitle: roleTitle.trim(), instructions, avatarColor, provider, model: model.trim(), collaborationEnabled, stealthBrowsing };
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 gb-pop"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold" style={{ color: "var(--text)" }}>
          {existing ? `Edit ${existing.name}` : "New agent"}
        </h2>

        <label className={label} style={labelStyle}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nova" className={`${field} mb-3`} style={fieldStyle} />

        <label className={label} style={labelStyle}>Job / role</label>
        <input
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          placeholder={`e.g. ${ROLE_EXAMPLES[Math.floor(Math.random() * ROLE_EXAMPLES.length)]}`}
          className={`${field} mb-3`}
          style={fieldStyle}
        />

        <label className={label} style={labelStyle}>
          Instructions & boundaries <span className="font-normal" style={{ color: "var(--muted)" }}>(what it owns, how you like work done, what needs approval)</span>
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="You own weekly competitor research. Save reports to workspace/reports. Never send emails without approval."
          className={`${field} mb-3 resize-y`}
          style={fieldStyle}
        />

        <div className="mb-3">
          <label className={label} style={labelStyle}>Avatar</label>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setAvatarColor(c)}
                className="h-6 w-6 rounded-full"
                style={{ backgroundColor: c, outline: avatarColor === c ? "2px solid var(--text)" : "none", outlineOffset: 2 }}
              />
            ))}
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label} style={labelStyle}>AI provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={field} style={fieldStyle}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.hasKey ? "" : " (no API key)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} className={field} style={fieldStyle} />
          </div>
        </div>
        {selectedProvider && !selectedProvider.hasKey && (
          <p
            className="mb-3 rounded-xl px-3 py-2 text-xs"
            style={{ background: "color-mix(in srgb, var(--warn) 12%, var(--bg))", color: "var(--warn)", border: "1px solid color-mix(in srgb, var(--warn) 40%, transparent)" }}
          >
            No API key configured for {selectedProvider.label}. Add it to your .env and restart the server (or use model <code>mock-scripted</code>).
          </p>
        )}

        <label className="mb-2 flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={collaborationEnabled} onChange={(e) => setCollaborationEnabled(e.target.checked)} className="h-4 w-4" />
          May message other agents (collaboration)
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={stealthBrowsing} onChange={(e) => setStealthBrowsing(e.target.checked)} className="h-4 w-4" />
          Stealth browsing <span style={{ color: "var(--muted)" }}>(anti-fingerprint: realistic UA, spoofed WebGL, hidden automation signals)</span>
        </label>

        {error && <p className="mb-3 text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim() || !model.trim()}
            className="rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl p-5 gb-pop"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold" style={{ color: "var(--text)" }}>New group chat</h2>
        <label className={label} style={labelStyle}>Group name</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website Launch" className={`${field} mb-3`} style={fieldStyle} />
        <label className={label} style={labelStyle}>Agents</label>
        <div className="mb-4 max-h-48 space-y-1 overflow-y-auto">
          {state.agents.filter((a) => !a.hidden).map((a) => (
            <label
              key={a.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
              style={{ color: "var(--text)" }}
            >
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))}
                className="h-4 w-4"
              />
              {a.name} <span className="text-xs" style={{ color: "var(--muted)" }}>· {a.roleTitle || "Agent"}</span>
            </label>
          ))}
        </div>
        {error && <p className="mb-3 text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={busy || !title.trim() || selected.length === 0}
            className="rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
