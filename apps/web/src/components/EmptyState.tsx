import { useStore } from "../store";

const SUGGESTED = [
  { role: "Researcher", blurb: "digs across the web and writes up findings" },
  { role: "Chief of Staff", blurb: "coordinates your other agents" },
  { role: "Inbox Assistant", blurb: "triages and drafts replies" },
];

export function EmptyState({ onNewAgent }: { onNewAgent: () => void }) {
  const { state } = useStore();
  const hasAgents = state.agents.length > 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8" style={{ color: "var(--text)" }}>
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
        style={{ background: "var(--accent)", color: "var(--accent-contrast)", boxShadow: "var(--shadow)" }}
      >
        💬
      </div>
      <h2 className="text-2xl font-bold tracking-tight">Your AI teammates</h2>
      <p className="mt-2 max-w-md text-center text-[15px]" style={{ color: "var(--muted)" }}>
        {hasAgents
          ? "Pick a conversation on the left, or create another teammate. Each agent has a job, a memory, and its own computer."
          : "Create a teammate, give it a job, and message it like a colleague. Each agent gets its own computer with a browser, terminal, and files."}
      </p>

      {!hasAgents && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {SUGGESTED.map((s) => (
            <div
              key={s.role}
              className="w-44 rounded-2xl p-3 text-left"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="text-sm font-semibold">{s.role}</div>
              <div className="mt-0.5 text-[12px]" style={{ color: "var(--muted)" }}>
                {s.blurb}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onNewAgent}
        className="mt-7 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
        style={{ background: "var(--accent)" }}
      >
        {hasAgents ? "New agent" : "Create your first teammate"}
      </button>
    </div>
  );
}
