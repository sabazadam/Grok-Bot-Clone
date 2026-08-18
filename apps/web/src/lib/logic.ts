import type { Bot, ProviderId } from "./types";

export const DESKTOP_WIDTH = 1280;
export const DESKTOP_HEIGHT = 720;

export const HARD_STOP_ACTIONS = [
  "send_external",
  "publish",
  "delete_outside_home",
  "purchase",
  "production_change",
] as const;

export type HardStopAction = (typeof HARD_STOP_ACTIONS)[number];

const MENTION_RE = /@([A-Za-z][\w-]{0,31})/g;

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "B";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function clampCursor(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(DESKTOP_WIDTH - 1, Math.round(x))),
    y: Math.max(0, Math.min(DESKTOP_HEIGHT - 1, Math.round(y))),
  };
}

export function parseMentions(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const name = match[1];
    if (name.toLowerCase() === "everyone") {
      names.add("everyone");
    } else {
      names.add(name);
    }
  }
  return [...names];
}

export function resolveMentionedBots(text: string, bots: Bot[]): Bot[] {
  const mentions = parseMentions(text).map((n) => n.toLowerCase());
  if (mentions.includes("everyone")) return bots;
  return bots.filter((bot) =>
    mentions.includes(bot.name.toLowerCase().replace(/\s+/g, "")),
  );
}

export function collaborationRequested(text: string): boolean {
  const mentions = parseMentions(text);
  if (mentions.length > 0) return true;
  return /\b(talk to|message|ask|hand off|handoff|coordinate with|tell)\b/i.test(
    text,
  );
}

export function looksLikeHardStop(text: string): HardStopAction | null {
  const t = text.toLowerCase();
  if (/\b(send|email|tweet|post to|dm them|ship the email)\b/.test(t)) {
    return "send_external";
  }
  if (/\b(publish|go live|deploy to prod)\b/.test(t)) return "publish";
  if (/\b(buy|purchase|pay|checkout)\b/.test(t)) return "purchase";
  if (/\b(delete|rm -rf|wipe|drop table)\b/.test(t)) return "delete_outside_home";
  if (/\b(production|prod database|rotate secrets)\b/.test(t)) {
    return "production_change";
  }
  return null;
}

export function screenCaption(input: {
  botName: string;
  cursor: { x: number; y: number };
  windows: { kind: string; title: string; focused: boolean; minimized: boolean }[];
  files: { name: string }[];
  browser: { url: string; title: string; body: string };
  terminal: { cwd: string; lines: string[] };
  lastAction: string;
}): string {
  const open = input.windows
    .filter((w) => !w.minimized)
    .map((w) => `${w.focused ? "*" : " "}${w.kind}:${w.title}`)
    .join("\n");
  const term = input.terminal.lines.slice(-6).join("\n");
  const body = input.browser.body.slice(0, 400);
  return [
    `Desktop for ${input.botName} (1280x720)`,
    `Cursor: ${input.cursor.x},${input.cursor.y}`,
    `Last action: ${input.lastAction || "none"}`,
    `Windows:\n${open || "(none)"}`,
    `Files: ${input.files.map((f) => f.name).join(", ") || "(empty)"}`,
    `Browser: ${input.browser.title} — ${input.browser.url}`,
    body ? `Visible page:\n${body}` : "",
    term ? `Terminal ${input.terminal.cwd}:\n${term}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function providerNeedsKey(provider: ProviderId): boolean {
  return provider !== "rehearsal";
}

export function isSafeShell(command: string): boolean {
  const blocked =
    /rm\s+-rf\s+\/|sudo\b|mkfs\b|dd\s+if=|:(){:|:&};:|shutdown\b|reboot\b|curl\s+[^\n]*\|\s*sh/i;
  return !blocked.test(command) && command.length < 2000;
}
