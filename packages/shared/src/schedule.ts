/** Clock-and-calendar schedules for routines (Grok Bot-style). */

export type RoutineSchedule =
  | {
      kind: "interval";
      everyMinutes: number;
      fromHour?: number;
      fromMinute?: number;
      untilHour?: number;
      untilMinute?: number;
    }
  | {
      kind: "daily";
      hour: number;
      minute: number;
      /** 0 = Sunday … 6 = Saturday. Omit = every day. */
      days?: number[];
    };

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const DAY_NAME: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const NAMED_CLOCK: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 8, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 21, minute: 0 },
  noon: { hour: 12, minute: 0 },
  midnight: { hour: 0, minute: 0 },
};

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_LONG.indexOf(map.weekday ?? "Sunday"),
  };
}

/** Instant for a wall-clock time in `timeZone`. */
export function zonedTime(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): number {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 6; i++) {
    const p = zonedParts(utc, timeZone);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = want - got;
    if (delta === 0) break;
    utc += delta;
  }
  return utc;
}

export function parseClock(raw: string): { hour: number; minute: number } | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (NAMED_CLOCK[s]) return NAMED_CLOCK[s];
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (!ap && hour === 24) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function parseDayList(text: string): number[] | undefined {
  const t = text.toLowerCase();
  if (/\bweekdays?\b/.test(t)) return WEEKDAYS;
  if (/\bweekends?\b/.test(t)) return WEEKENDS;
  const days: number[] = [];
  for (const [name, n] of Object.entries(DAY_NAME)) {
    const re = new RegExp(`\\b${name}s?\\b`);
    if (re.test(t) && !days.includes(n)) days.push(n);
  }
  return days.length ? days.sort((a, b) => a - b) : undefined;
}

/**
 * Parse phrases like:
 *   every 30 minutes until 4 AM
 *   every morning / every evening
 *   every weekday at 8:00 AM
 *   daily at 9:30
 */
export function parseSchedule(text: string): RoutineSchedule | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return undefined;

  const untilMatch = t.match(/\buntil\s+(.+)$/);
  const until = untilMatch?.[1] ? parseClock(untilMatch[1]) : undefined;
  const head = untilMatch ? t.slice(0, untilMatch.index).trim() : t;

  const everyNm = head.match(/^(?:every|each)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)$/);
  if (everyNm) {
    const n = Number(everyNm[1]);
    const unit = everyNm[2] ?? "minutes";
    const everyMinutes = /hour|hr/.test(unit) ? n * 60 : n;
    if (everyMinutes < 1) return undefined;
    const sched: RoutineSchedule = { kind: "interval", everyMinutes };
    if (until) {
      sched.untilHour = until.hour;
      sched.untilMinute = until.minute;
    }
    return sched;
  }

  const named = head.match(/^(?:every|each)\s+(?:(weekdays?|weekends?|\w+days?)\s+)?(morning|evening|night|noon|midnight)$/);
  if (named) {
    const clock = NAMED_CLOCK[named[2]!]!;
    const days = parseDayList(t);
    return { kind: "daily", hour: clock.hour, minute: clock.minute, days };
  }

  const at = t.match(/(?:^|\s)(?:at\s+)?(.+?)$/);
  const days = parseDayList(t);
  const clockPart =
    t.match(/\bat\s+(.+?)(?:\s+until\s+.+)?$/)?.[1] ??
    t.match(/^(?:every|each)\s+(?:day\s+)?(.+)$/)?.[1] ??
    t.match(/^daily\s+(?:at\s+)?(.+)$/)?.[1];
  if (/\b(every|each)\s+day\b/.test(t) || /^daily\b/.test(t) || (days && clockPart) || /\bat\s+/.test(t)) {
    const clock = parseClock((clockPart ?? at?.[1] ?? "").replace(/\buntil\b.+$/, "").trim()) ?? (days ? NAMED_CLOCK.morning : undefined);
    if (!clock) return undefined;
    return { kind: "daily", hour: clock.hour, minute: clock.minute, days };
  }

  if (until && /^every/.test(t)) return undefined;
  const bareClock = parseClock(t);
  if (bareClock) return { kind: "daily", hour: bareClock.hour, minute: bareClock.minute };
  return undefined;
}

export function formatSchedule(s: RoutineSchedule): string {
  if (s.kind === "interval") {
    const n = s.everyMinutes % 60 === 0 && s.everyMinutes >= 60 ? `${s.everyMinutes / 60} hour(s)` : `${s.everyMinutes} minute(s)`;
    let out = `every ${n}`;
    if (s.untilHour !== undefined) {
      out += ` until ${formatClock(s.untilHour, s.untilMinute ?? 0)}`;
    }
    return out;
  }
  const when = formatClock(s.hour, s.minute);
  if (!s.days || s.days.length === 7) return `every day at ${when}`;
  if (s.days.length === 5 && WEEKDAYS.every((d) => s.days!.includes(d))) return `weekdays at ${when}`;
  if (s.days.length === 2 && WEEKENDS.every((d) => s.days!.includes(d))) return `weekends at ${when}`;
  return `${s.days.map((d) => WEEKDAY_LONG[d]!.slice(0, 3)).join(", ")} at ${when}`;
}

function formatClock(hour: number, minute: number): string {
  const ap = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${h}:${String(minute).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
}

function minutesOfDay(h: number, m: number): number {
  return h * 60 + m;
}

function inWindow(t: number, from: number, until: number): boolean {
  if (from === until) return true;
  if (from < until) return t >= from && t < until;
  return t >= from || t < until;
}

function addCalendarDays(timeZone: string, p: ZonedParts, days: number): ZonedParts {
  const noon = zonedTime(timeZone, p.year, p.month, p.day, 12, 0) + days * 86_400_000;
  return zonedParts(noon, timeZone);
}

export function nextRunAt(schedule: RoutineSchedule, fromMs: number, timeZone: string): number {
  if (schedule.kind === "daily") {
    const allowed = schedule.days && schedule.days.length > 0 ? new Set(schedule.days) : null;
    const start = zonedParts(fromMs, timeZone);
    for (let i = 0; i < 16; i++) {
      const day = addCalendarDays(timeZone, start, i);
      if (allowed && !allowed.has(day.weekday)) continue;
      const slot = zonedTime(timeZone, day.year, day.month, day.day, schedule.hour, schedule.minute);
      if (slot > fromMs) return slot;
    }
    return fromMs + 86_400_000;
  }

  const everyMs = Math.max(1, schedule.everyMinutes) * 60_000;
  const fromMin =
    schedule.fromHour !== undefined ? minutesOfDay(schedule.fromHour, schedule.fromMinute ?? 0) : undefined;
  const untilMin =
    schedule.untilHour !== undefined ? minutesOfDay(schedule.untilHour, schedule.untilMinute ?? 0) : undefined;

  if (untilMin === undefined) {
    return fromMs + everyMs;
  }

  const windowFrom = fromMin ?? 0;
  let candidate = fromMs + everyMs;
  for (let i = 0; i < 200; i++) {
    const p = zonedParts(candidate, timeZone);
    const t = minutesOfDay(p.hour, p.minute);
    if (inWindow(t, windowFrom, untilMin)) return candidate;
    candidate += everyMs;
  }

  const p = zonedParts(fromMs, timeZone);
  const startToday = zonedTime(timeZone, p.year, p.month, p.day, schedule.fromHour ?? 0, schedule.fromMinute ?? 0);
  if (startToday > fromMs) return startToday;
  const tomorrow = addCalendarDays(timeZone, p, 1);
  return zonedTime(timeZone, tomorrow.year, tomorrow.month, tomorrow.day, schedule.fromHour ?? 0, schedule.fromMinute ?? 0);
}

/** Fill an overnight "until" window's start from "now" so it continues tonight. */
export function withWindowStart(schedule: RoutineSchedule, nowMs: number, timeZone: string): RoutineSchedule {
  if (schedule.kind !== "interval" || schedule.untilHour === undefined || schedule.fromHour !== undefined) {
    return schedule;
  }
  const p = zonedParts(nowMs, timeZone);
  return { ...schedule, fromHour: p.hour, fromMinute: p.minute };
}

export function intervalMinutesOf(schedule: RoutineSchedule): number {
  return schedule.kind === "interval" ? schedule.everyMinutes : 24 * 60;
}
