import { useId } from "react";
import type { Agent, AgentStatus, FaceShape } from "@grokbot/shared";
import { FACE_SHAPES } from "@grokbot/shared";

export type FaceMood = "idle" | "write" | "talk" | "wait" | "off";

export const STATUS_LABELS: Record<AgentStatus, string> = {
  off: "Computer off",
  starting: "Starting…",
  idle: "Online",
  working: "Working…",
  waiting_approval: "Waiting for you",
  error: "Error",
};

/** Stable official-style shape. Prefer a saved picker shape, then a name hash. */
export function shapeForAgent(id: string, name?: string, saved?: FaceShape): FaceShape {
  if (saved && (FACE_SHAPES as readonly string[]).includes(saved)) return saved;
  const key = `${name ?? ""}|${id}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return FACE_SHAPES[(h >>> 0) % FACE_SHAPES.length]!;
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
      return "M50 6a44 44 0 1 1 0 88a44 44 0 1 1 0-88z";
    case "blob":
      return "M22 40c-4 14 2 32 18 40 12 6 28 6 38-4 12-12 14-30 8-42C80 20 64 10 50 12 34 14 26 26 22 40z";
    case "squircle":
      return "M24 12h52c14 0 22 8 22 22v32c0 14-8 22-22 22H24C10 88 2 80 2 66V34C2 20 10 12 24 12z";
    case "pill":
      return "M22 28h56c12 0 20 10 20 22s-8 22-20 22H22C10 72 2 62 2 50s8-22 20-22z";
    case "triangle":
      return "M50 10c6 0 12 4 16 12l24 48c4 8 1 18-8 22H18c-9-4-12-14-8-22l24-48C38 14 44 10 50 10z";
    case "hexagon":
      return "M50 6L90 28v44L50 94 10 72V28z";
    case "cloud":
      return "M28 58c-10 0-16-8-16-16 0-9 7-16 16-16 3-10 12-16 22-16 12 0 21 8 24 18 10 1 18 9 18 18 0 10-8 18-18 18H28z";
    case "drop":
      return "M50 4C38 22 18 44 18 64c0 20 14 30 32 30s32-10 32-30C82 44 62 22 50 4z";
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
  // Eyes are vertically centered on the face; nudge per-shape so they sit in the "mass" of the shape.
  const eyeCy = shape === "drop" ? 56 : shape === "triangle" ? 60 : shape === "cloud" ? 50 : shape === "hexagon" ? 52 : 50;
  const eyeW = 13;
  const eyeH = 26;
  const gap = 22;

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
        {/* Subtle top-down sheen for soft volume — matte, not glossy (matches official Grok Bot). */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={shapePath(shape)} />
        </clipPath>
      </defs>
      <path d={shapePath(shape)} fill={color} />
      <g clipPath={`url(#${clipId})`}>
        <path d={shapePath(shape)} fill={`url(#${gradId})`} />
        <g className="gb-eyes">
          <rect
            className="gb-eye"
            x={50 - gap}
            y={eyeCy - eyeH / 2}
            width={eyeW}
            height={eyeH}
            rx={eyeW / 2}
            fill="#fff"
          />
          <rect
            className="gb-eye"
            x={50 + gap - eyeW}
            y={eyeCy - eyeH / 2}
            width={eyeW}
            height={eyeH}
            rx={eyeW / 2}
            fill="#fff"
          />
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
  agent: Pick<Agent, "id" | "name" | "avatarColor" | "status"> & { avatarShape?: FaceShape };
  size?: number;
  showStatus?: boolean;
  mood?: FaceMood;
}) {
  const resolved = mood ?? moodForStatus(agent.status);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={STATUS_LABELS[agent.status]}>
      <BotFace
        color={agent.avatarColor}
        shape={shapeForAgent(agent.id, agent.name, agent.avatarShape)}
        mood={resolved}
        size={size}
        title={agent.name}
        delayMs={hashDelay(agent.id)}
      />
      {showStatus && agent.status === "waiting_approval" && <span className="gb-wait-dot" aria-hidden />}
    </div>
  );
}

export function GroupAvatar({
  agents,
  size = 40,
}: {
  agents: (Pick<Agent, "id" | "name" | "avatarColor" | "status"> & { avatarShape?: FaceShape })[];
  size?: number;
}) {
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
            shape={shapeForAgent(a.id, a.name, a.avatarShape)}
            mood={moodForStatus(a.status)}
            size={size * 0.72}
            delayMs={hashDelay(a.id)}
          />
        </div>
      ))}
    </div>
  );
}
