import { useStore } from "../store";
import { BotFace } from "./Avatar";

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
      <div className="mb-6 flex items-end gap-2">
        <BotFace color="#F46A1B" shape="circle" mood="idle" size={44} />
        <BotFace color="#3B82F6" shape="blob" mood="talk" size={38} />
        <BotFace color="#E56B8A" shape="drop" mood="write" size={36} />
        <BotFace color="#7C5CBF" shape="cloud" mood="idle" size={34} />
        <BotFace color="#2A9D8F" shape="pill" mood="talk" size={32} />
        <BotFace color="#D6453D" shape="hexagon" mood="wait" size={28} />
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
