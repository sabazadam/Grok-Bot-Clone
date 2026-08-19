export function timeLabel(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function dayStamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

export function shouldStamp(prevTs: number | undefined, ts: number): boolean {
  if (prevTs === undefined) return true;
  if (new Date(prevTs).toDateString() !== new Date(ts).toDateString()) return true;
  return ts - prevTs > 3 * 60 * 60 * 1000;
}

export function handoffPeerName(text: string): string | undefined {
  const m =
    text.match(/^Messaged\s+(.+)$/) ||
    text.match(/^From\s+(.+)$/) ||
    text.match(/^→\s*@([^\s:]+)/);
  return m?.[1]?.replace(/:$/, "").trim();
}

export function handoffVerb(text: string): "Messaged" | "From" {
  return /^From\s+/.test(text) ? "From" : "Messaged";
}

export function isHandoffLine(text: string): boolean {
  return /^(Messaged |From |→\s*@)/.test(text);
}

export function isDelegationLine(text: string): boolean {
  return /^Delegated to /.test(text);
}

/** Names listed in a "Delegated to A, B" chip (empty if it used the "N specialist(s)" fallback). */
export function delegationTargets(text: string): string[] {
  const m = text.match(/^Delegated to (.+)$/);
  if (!m) return [];
  if (/specialist\(s\)$/.test(m[1]!)) return [];
  return m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
}

export function newDividerIndex(messageIds: string[], lastSeenId?: string, lastUserIdx = -1): number {
  if (lastSeenId) {
    const seen = messageIds.indexOf(lastSeenId);
    if (seen >= 0 && seen < messageIds.length - 1) return seen + 1;
    if (seen === messageIds.length - 1) return -1;
  }
  return lastUserIdx;
}
