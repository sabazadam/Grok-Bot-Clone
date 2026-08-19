import { describe, it, expect } from "vitest";
import { formatSchedule, nextRunAt, parseSchedule, withWindowStart, zonedParts, zonedTime } from "@grokbot/shared";

const TZ = "America/New_York";

describe("parseSchedule", () => {
  it("parses every N minutes until a clock time", () => {
    expect(parseSchedule("every 30 minutes until 4 AM")).toEqual({
      kind: "interval",
      everyMinutes: 30,
      untilHour: 4,
      untilMinute: 0,
    });
    expect(parseSchedule("every 2 hours")).toEqual({ kind: "interval", everyMinutes: 120 });
  });

  it("parses every morning / evening", () => {
    expect(parseSchedule("every morning")).toEqual({ kind: "daily", hour: 8, minute: 0 });
    expect(parseSchedule("every evening")).toEqual({ kind: "daily", hour: 18, minute: 0 });
  });

  it("parses weekday clocks", () => {
    expect(parseSchedule("every weekday at 8:00 AM")).toEqual({
      kind: "daily",
      hour: 8,
      minute: 0,
      days: [1, 2, 3, 4, 5],
    });
    expect(parseSchedule("weekdays at 8am")).toEqual({
      kind: "daily",
      hour: 8,
      minute: 0,
      days: [1, 2, 3, 4, 5],
    });
    expect(parseSchedule("every weekday morning")).toEqual({
      kind: "daily",
      hour: 8,
      minute: 0,
      days: [1, 2, 3, 4, 5],
    });
  });

  it("returns undefined for junk", () => {
    expect(parseSchedule("whenever you feel like it")).toBeUndefined();
  });
});

describe("nextRunAt", () => {
  it("daily: next 8 AM after 7 AM is today; after 9 AM is tomorrow", () => {
    const seven = zonedTime(TZ, 2026, 8, 19, 7, 0);
    const nine = zonedTime(TZ, 2026, 8, 19, 9, 0);
    const sched = { kind: "daily" as const, hour: 8, minute: 0 };
    const nextFromSeven = nextRunAt(sched, seven, TZ);
    const nextFromNine = nextRunAt(sched, nine, TZ);
    expect(zonedParts(nextFromSeven, TZ)).toMatchObject({ day: 19, hour: 8, minute: 0 });
    expect(zonedParts(nextFromNine, TZ)).toMatchObject({ day: 20, hour: 8, minute: 0 });
  });

  it("interval until 4 AM continues overnight then waits for the next window", () => {
    const tenPm = zonedTime(TZ, 2026, 8, 19, 22, 0);
    const sched = withWindowStart(
      { kind: "interval", everyMinutes: 30, untilHour: 4, untilMinute: 0 },
      tenPm,
      TZ,
    );
    const first = nextRunAt(sched, tenPm, TZ);
    expect(zonedParts(first, TZ)).toMatchObject({ day: 19, hour: 22, minute: 30 });

    const almostFour = zonedTime(TZ, 2026, 8, 20, 3, 40);
    const afterWindow = nextRunAt(sched, almostFour, TZ);
    const p = zonedParts(afterWindow, TZ);
    expect(p.hour).toBeGreaterThanOrEqual(22);
    expect(p.day).toBe(20);
  });

  it("weekdays at 8 AM skip Saturday", () => {
    // 2026-08-21 is Friday
    const fridayNine = zonedTime(TZ, 2026, 8, 21, 9, 0);
    const next = nextRunAt({ kind: "daily", hour: 8, minute: 0, days: [1, 2, 3, 4, 5] }, fridayNine, TZ);
    const p = zonedParts(next, TZ);
    expect(p.weekday).toBe(1); // Monday
    expect(p.hour).toBe(8);
  });
});

describe("formatSchedule", () => {
  it("prints a readable label", () => {
    expect(formatSchedule({ kind: "daily", hour: 8, minute: 0 })).toBe("every day at 8 AM");
    expect(formatSchedule({ kind: "interval", everyMinutes: 30, untilHour: 4, untilMinute: 0 })).toBe(
      "every 30 minute(s) until 4 AM",
    );
  });
});
