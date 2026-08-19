import { useId } from "react";
import type { Agent, AgentStatus } from "@grokbot/shared";

export type FaceShape = "circle" | "drop" | "squircle" | "hexagon";
export type FaceMood = "idle" | "write" | "talk" | "wait" | "off";

export const STATUS_LABELS: Record<AgentStatus, string> = {
  off: "Computer off",
  starting: "Starting…",
  idle: "Online",
  working: "Working…",
  waiting_approval: "Waiting for you",
  error: "Error",
};

const SHAPES: FaceShape[] = ["circle", "drop", "squircle", "hexagon"];

/** Stable official-style shape. Prefer the name so a roster shows mixed faces. */
export function shapeForAgent(id: string, name?: string): FaceShape {
  const key = `${name ?? ""}|${id}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return SHAPES[h >>> 0 & 3]!;
}

export function moodForStatus(status: AgentStatus): FaceMood {
  if (status === "waiting_approval") return "wait";
  if (status === "working") return "write";
  if (status === "starting") return "talk";
  if (status === "off" || status === "error") return "off";
  return "idle";
}

function hashDelay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 900;
  return h;
}

function shapePath(shape: FaceShape): string {
  switch (shape) {
    case "circle":
      return "M50 5.5a44.5 44.5 0 1 1 0 89a44.5 44.5 0 1 1 0-89z";
    case "drop":
      return "M50 4C38 22 20 42 20 62c0 18 13 32 30 32s30-14 30-32C80 42 62 22 50 4z";
    case "squircle":
      return "M24 12h52c14 0 22 8 22 22v32c0 14-8 22-22 22H24C10 88 2 80 2 66V34C2 20 10 12 24 12z";
    case "hexagon":
      return "M50 5L91 27.5v45L50 95 9 72.5v-45z";
  }
}

export function BotFace({
  color,
  shape,
  mood = "idle",
  size = 40,
  title,
  delayMs = 0,
}: {
  color: string;
  shape: FaceShape;
  mood?: FaceMood;
  size?: number;
  title?: string;
  delayMs?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const clipId = `gb-clip-${uid}`;
  const gradId = `gb-grad-${uid}`;
  const shineId = `gb-shine-${uid}`;
  const eyeY = shape === "drop" ? 42 : shape === "hexagon" ? 38 : 36;
  const eyeW = size < 22 ? 13 : 11;
  const eyeH = size < 22 ? 24 : 22;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`gb-face gb-face-${mood}`}
      style={{ animationDelay: `${delayMs}ms` }}
      aria-label={title}
      role="img"
    >
      <defs>
        <radialGradient id={gradId} cx="35%" cy="28%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="45%" stopColor={color} stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
        </radialGradient>
        <radialGradient id={shineId} cx="38%" cy="30%" r="22%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clipId}>
          <path d={shapePath(shape)} />
        </clipPath>
      </defs>
      <path d={shapePath(shape)} fill={color} />
      <g clipPath={`url(#${clipId})`}>
        <path d={shapePath(shape)} fill={`url(#${gradId})`} />
        <ellipse cx="38" cy="30" rx="16" ry="10" fill={`url(#${shineId})`} />
        <g className="gb-eyes">
          <rect className="gb-eye" x={32} y={eyeY} width={eyeW} height={eyeH} rx={eyeW / 2} fill="#fff" />
          <rect className="gb-eye" x={57} y={eyeY} width={eyeW} height={eyeH} rx={eyeW / 2} fill="#fff" />
        </g>
      </g>
    </svg>
  );
}

export function Avatar({
  agent,
  size = 40,
  showStatus = false,
  mood,
}: {
  agent: Pick<Agent, "id" | "name" | "avatarColor" | "status">;
  size?: number;
  showStatus?: boolean;
  mood?: FaceMood;
}) {
  const resolved = mood ?? moodForStatus(agent.status);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={STATUS_LABELS[agent.status]}>
      <BotFace
        color={agent.avatarColor}
        shape={shapeForAgent(agent.id, agent.name)}
        mood={resolved}
        size={size}
        title={agent.name}
        delayMs={hashDelay(agent.id)}
      />
      {showStatus && agent.status === "waiting_approval" && <span className="gb-wait-dot" aria-hidden />}
    </div>
  );
}

export function GroupAvatar({ agents, size = 40 }: { agents: Pick<Agent, "id" | "name" | "avatarColor" | "status">[]; size?: number }) {
  const shown = agents.slice(0, 2);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {shown.map((a, i) => (
        <div
          key={a.id}
          className="absolute"
          style={{
            width: size * 0.72,
            height: size * 0.72,
            left: i === 0 ? 0 : size * 0.28,
            top: i === 0 ? 0 : size * 0.28,
            zIndex: 2 - i,
          }}
        >
          <BotFace
            color={a.avatarColor}
            shape={shapeForAgent(a.id, a.name)}
            mood={moodForStatus(a.status)}
            size={size * 0.72}
            delayMs={hashDelay(a.id)}
          />
        </div>
      ))}
    </div>
  );
}
