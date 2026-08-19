export type LastSeenMap = Record<string, { id: string; at: number }>;

const LAST_SEEN_KEY = "grokbot.lastSeen";

export function readLastSeen(): LastSeenMap {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}") as Record<string, unknown>;
    const out: LastSeenMap = {};
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === "string") out[id] = { id: value, at: Date.now() };
      else if (value && typeof value === "object" && "id" in value) {
        const entry = value as { id?: unknown; at?: unknown };
        out[id] = { id: String(entry.id ?? ""), at: typeof entry.at === "number" ? entry.at : Date.now() };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLastSeen(map: LastSeenMap) {
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
}
