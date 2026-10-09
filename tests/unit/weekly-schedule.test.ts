import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKLY_CRON,
  DEFAULT_WEEKLY_DAYS,
  DEFAULT_WEEKLY_TIME,
  dueWeeklyRunAt,
  nextWeeklyRunAt,
  parseWeeklyCron,
  weeklyCron,
} from "@/server/weekly-schedule";

it("defaults to Sunday midnight and finds the preceding weekly run", () => {
  expect(DEFAULT_WEEKLY_DAYS).toEqual([0]);
  expect(DEFAULT_WEEKLY_TIME).toBe("00:00");
  const monday = new Date("2026-09-28T16:00:00.000Z");
  expect(dueWeeklyRunAt(monday, "America/New_York", DEFAULT_WEEKLY_TIME, DEFAULT_WEEKLY_DAYS).toISOString())
    .toBe("2026-09-27T04:00:00.000Z");
  expect(nextWeeklyRunAt(monday, "America/New_York", DEFAULT_WEEKLY_TIME, DEFAULT_WEEKLY_DAYS).toISOString())
    .toBe("2026-10-04T04:00:00.000Z");
});

const NY = "America/New_York";
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

describe("nextWeeklyRunAt", () => {
  it("finds noon today when now is before it, in EDT", () => {
    // 2026-09-17 is a Thursday, EDT (UTC-4).
    const now = new Date("2026-09-17T14:00:00Z"); // 10:00 local
    const next = nextWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-09-17T16:00:00.000Z"); // 12:00 EDT
  });

  it("rolls to tomorrow when now is exactly at the scheduled instant", () => {
    const now = new Date("2026-09-17T16:00:00.000Z"); // exactly noon EDT
    const next = nextWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-09-18T16:00:00.000Z");
  });

  it("rolls to tomorrow when now is a minute past noon", () => {
    const now = new Date("2026-09-17T16:01:00.000Z");
    const next = nextWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-09-18T16:00:00.000Z");
  });

  it("finds noon today when now is a minute before it", () => {
    const now = new Date("2026-09-17T15:59:00.000Z");
    const next = nextWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-09-17T16:00:00.000Z");
  });

  it("finds noon EST once daylight saving has ended", () => {
    // 2026-11-02 is after the US fall-back (2026-11-01), so NY is back on UTC-5.
    const now = new Date("2026-11-02T14:00:00Z");
    const next = nextWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-11-02T17:00:00.000Z"); // 12:00 EST
  });

  it("skips the weekend for a weekdays-only schedule", () => {
    // 2026-09-18 is a Friday; the next weekday occurrence is Monday 2026-09-21.
    const now = new Date("2026-09-18T17:00:00.000Z"); // just after Friday noon EDT
    const next = nextWeeklyRunAt(now, NY, "12:00", WEEKDAYS);
    expect(next.toISOString()).toBe("2026-09-21T16:00:00.000Z");
  });

  it("falls back to the default schedule when the stored time is malformed", () => {
    const now = new Date("2026-09-17T14:00:00Z");
    const next = nextWeeklyRunAt(now, NY, "not-a-time", ALL_DAYS);
    expect(next.toISOString()).toBe(nextWeeklyRunAt(now, NY, DEFAULT_WEEKLY_TIME, DEFAULT_WEEKLY_DAYS).toISOString());
  });

  it("falls back to the default schedule when every day is cleared", () => {
    const now = new Date("2026-09-17T14:00:00Z");
    const next = nextWeeklyRunAt(now, NY, "12:00", []);
    expect(next.toISOString()).toBe(nextWeeklyRunAt(now, NY, DEFAULT_WEEKLY_TIME, DEFAULT_WEEKLY_DAYS).toISOString());
  });

  it("handles UTC directly", () => {
    const now = new Date("2026-09-17T10:00:00Z");
    const next = nextWeeklyRunAt(now, "UTC", "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-09-17T12:00:00.000Z");
  });

  it("handles a half-hour offset zone", () => {
    // Asia/Kolkata is UTC+5:30 year-round.
    const now = new Date("2026-09-17T00:00:00Z"); // 05:30 local
    const next = nextWeeklyRunAt(now, "Asia/Kolkata", "12:00", ALL_DAYS);
    expect(next.toISOString()).toBe("2026-09-17T06:30:00.000Z"); // 12:00 IST
  });
});

describe("dueWeeklyRunAt", () => {
  it("returns today's occurrence once it has passed", () => {
    const now = new Date("2026-09-17T22:00:00.000Z"); // 18:00 EDT, after noon
    const due = dueWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(due.toISOString()).toBe("2026-09-17T16:00:00.000Z");
  });

  it("returns yesterday's occurrence before today's has arrived", () => {
    const now = new Date("2026-09-17T10:00:00.000Z"); // 06:00 EDT, before noon
    const due = dueWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(due.toISOString()).toBe("2026-09-16T16:00:00.000Z");
  });

  it("returns exactly now when now is the scheduled instant", () => {
    const now = new Date("2026-09-17T16:00:00.000Z");
    const due = dueWeeklyRunAt(now, NY, "12:00", ALL_DAYS);
    expect(due.toISOString()).toBe(now.toISOString());
  });
});

describe("weekly cron", () => {
  it("writes days and a time as minute hour * * days, and reads them back", () => {
    expect(weeklyCron({ days: DEFAULT_WEEKLY_DAYS, time: DEFAULT_WEEKLY_TIME })).toBe(DEFAULT_WEEKLY_CRON);
    expect(weeklyCron({ days: [5, 1, 3, 1], time: "07:05" })).toBe("5 7 * * 1,3,5");
    expect(parseWeeklyCron("5 7 * * 1,3,5")).toEqual({ days: [1, 3, 5], time: "07:05" });
    expect(parseWeeklyCron(" 59 23 * * 6,0 ")).toEqual({ days: [0, 6], time: "23:59" });
  });

  it("refuses a schedule cron cannot hold", () => {
    expect(() => weeklyCron({ days: [], time: "00:00" })).toThrow();
    expect(() => weeklyCron({ days: [7], time: "00:00" })).toThrow();
    expect(() => weeklyCron({ days: [0], time: "24:00" })).toThrow();
  });

  it("reads anything it did not write as Sunday at midnight", () => {
    for (const cron of ["", "*/15 * * * *", "0 0 1 * *", "60 0 * * 0", "0 24 * * 0", "0 0 * * 7", "0 0 * * mon"]) {
      expect(parseWeeklyCron(cron), cron).toEqual({ days: [0], time: "00:00" });
    }
  });
});
