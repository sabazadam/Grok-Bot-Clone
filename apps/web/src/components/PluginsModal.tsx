import { useState } from "react";
import type { PluginKind } from "@grokbot/shared";
import { api } from "../api";
import { useStore } from "../store";

export function PluginsModal({ onClose }: { onClose: () => void }) {
  const { state, refreshPlugins } = useStore();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PluginKind>("webhook");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const card = { background: "var(--surface)", border: "1px solid var(--border)" } as const;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.createPlugin({
        name: name.trim(),
        kind,
        command: kind === "mcp" ? command.trim() : undefined,
        args: kind === "mcp" ? args.split(/\s+/).filter(Boolean) : undefined,
        url: kind === "webhook" ? url.trim() : undefined,
      });
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      await refreshPlugins();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 gb-pop"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-bold">Plugins</h2>
        <p className="mb-4 text-[13px]" style={{ color: "var(--muted)" }}>
          Connectors agents can call with <code>call_plugin</code>. MCP runs a local stdio server; webhooks POST JSON to a URL.
        </p>

        <div className="mb-4 space-y-2">
          {state.plugins.length === 0 && (
            <p className="text-[13px]" style={{ color: "var(--muted)" }}>
              None configured yet.
            </p>
          )}
          {state.plugins.map((p) => (
            <div key={p.id} className="flex items-start gap-2 rounded-xl px-3 py-2" style={card}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">
                  {p.name}{" "}
                  <span className="font-normal" style={{ color: "var(--muted)" }}>
                    {p.kind}
                  </span>
                </div>
                <div className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
                  {p.kind === "mcp" ? [p.command, ...(p.args ?? [])].filter(Boolean).join(" ") : p.url}
                </div>
              </div>
              <button
                className="text-[12px]"
                style={{ color: p.enabled ? "var(--ok)" : "var(--muted)" }}
                onClick={async () => {
                  await api.updatePlugin(p.id, { enabled: !p.enabled });
                  await refreshPlugins();
                }}
              >
                {p.enabled ? "On" : "Off"}
              </button>
              <button
                className="text-[12px]"
                style={{ color: "var(--danger)" }}
                onClick={async () => {
                  await api.deletePlugin(p.id);
                  await refreshPlugins();
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Add plugin
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="mb-2 w-full rounded-xl px-3 py-2 text-sm"
          style={card}
        />
        <div className="mb-2 flex gap-2 text-[13px]">
          {(["webhook", "mcp"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="rounded-full px-3 py-1"
              style={{
                background: kind === k ? "var(--accent)" : "var(--surface)",
                color: kind === k ? "var(--accent-contrast)" : "var(--text)",
              }}
            >
              {k === "webhook" ? "Webhook" : "MCP"}
            </button>
          ))}
        </div>
        {kind === "mcp" ? (
          <>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Command, e.g. npx"
              className="mb-2 w-full rounded-xl px-3 py-2 text-sm"
              style={card}
            />
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="Args, e.g. -y @modelcontextprotocol/server-github"
              className="mb-2 w-full rounded-xl px-3 py-2 text-sm"
              style={card}
            />
          </>
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
            className="mb-2 w-full rounded-xl px-3 py-2 text-sm"
            style={card}
          />
        )}
        {error && (
          <p className="mb-2 text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
            Close
          </button>
          <button
            disabled={busy || !name.trim() || (kind === "mcp" ? !command.trim() : !url.trim())}
            onClick={() => void add()}
            className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
