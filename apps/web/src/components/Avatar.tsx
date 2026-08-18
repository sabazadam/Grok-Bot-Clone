import type { Agent, AgentStatus } from "@grokbot/shared";

export const STATUS_COLORS: Record<AgentStatus, string> = {
  off: "var(--muted)",
  starting: "var(--warn)",
  idle: "var(--ok)",
  working: "var(--accent)",
  waiting_approval: "var(--warn)",
  error: "var(--danger)",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  off: "Computer off",
  starting: "Starting computer…",
  idle: "Online",
  working: "Working…",
  waiting_approval: "Waiting for your approval",
  error: "Error",
};

export function Avatar({
  agent,
  size = 40,
  showStatus = true,
}: {
  agent: Pick<Agent, "name" | "avatarColor" | "status">;
  size?: number;
  showStatus?: boolean;
}) {
  const initials = agent.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const working = agent.status === "working" || agent.status === "starting";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white shadow-sm"
        style={{ backgroundColor: agent.avatarColor, fontSize: size * 0.38 }}
      >
        {initials}
      </div>
      {showStatus && (
        <span
          className="absolute -right-0.5 -bottom-0.5 block rounded-full"
          style={{
            width: size * 0.32,
            height: size * 0.32,
            backgroundColor: STATUS_COLORS[agent.status],
            border: "2px solid var(--sidebar)",
            boxShadow: working ? `0 0 0 0 ${"var(--accent)"}` : undefined,
            animation: working ? "gb-pulse 1.4s ease-out infinite" : undefined,
          }}
          title={STATUS_LABELS[agent.status]}
        />
      )}
      <style>{`@keyframes gb-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent)}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}`}</style>
    </div>
  );
}

export function GroupAvatar({ agents, size = 40 }: { agents: Pick<Agent, "name" | "avatarColor" | "status">[]; size?: number }) {
  const shown = agents.slice(0, 2);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {shown.map((a, i) => (
        <div
          key={a.name + i}
          className="absolute flex items-center justify-center rounded-full font-semibold text-white"
          style={{
            backgroundColor: a.avatarColor,
            width: size * 0.68,
            height: size * 0.68,
            fontSize: size * 0.26,
            left: i === 0 ? 0 : size * 0.32,
            top: i === 0 ? 0 : size * 0.32,
            zIndex: 2 - i,
            border: "2px solid var(--sidebar)",
          }}
        >
          {a.name[0]?.toUpperCase()}
        </div>
      ))}
    </div>
  );
}
