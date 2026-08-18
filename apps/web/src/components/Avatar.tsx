import type { Agent, AgentStatus } from "@grokbot/shared";

export const STATUS_COLORS: Record<AgentStatus, string> = {
  off: "bg-neutral-600",
  starting: "bg-amber-400",
  idle: "bg-emerald-500",
  working: "bg-sky-400",
  waiting_approval: "bg-orange-500",
  error: "bg-red-500",
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
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
        style={{ backgroundColor: agent.avatarColor, fontSize: size * 0.38 }}
      >
        {initials}
      </div>
      {showStatus && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 block rounded-full border-2 border-neutral-900 ${STATUS_COLORS[agent.status]}`}
          style={{ width: size * 0.32, height: size * 0.32 }}
          title={STATUS_LABELS[agent.status]}
        />
      )}
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
          className="absolute flex items-center justify-center rounded-full border-2 border-neutral-900 font-semibold text-white"
          style={{
            backgroundColor: a.avatarColor,
            width: size * 0.68,
            height: size * 0.68,
            fontSize: size * 0.26,
            left: i === 0 ? 0 : size * 0.32,
            top: i === 0 ? 0 : size * 0.32,
            zIndex: 2 - i,
          }}
        >
          {a.name[0]?.toUpperCase()}
        </div>
      ))}
    </div>
  );
}
