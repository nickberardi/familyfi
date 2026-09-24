import { describe, expect, it } from "vitest";
import {
  assertSchedule,
  extendSuspensionUntil,
  inRecurringWindow,
  isDesiredBlocked,
} from "@/lib/schedule";

const zone = "America/New_York";

function at(isoLocalish: string): Date {
  return new Date(isoLocalish);
}

describe("schedule windows", () => {
  const schoolNights = {
    enabled: true,
    days: [1, 2, 3, 4, 5],
    start: "21:30",
    end: "06:45",
  };

  it("blocks overnight into the next morning", () => {
    expect(inRecurringWindow(at("2026-09-15T02:00:00-04:00"), schoolNights, zone)).toBe(true);
    expect(inRecurringWindow(at("2026-09-15T06:44:00-04:00"), schoolNights, zone)).toBe(true);
    expect(inRecurringWindow(at("2026-09-15T06:45:00-04:00"), schoolNights, zone)).toBe(false);
    expect(inRecurringWindow(at("2026-09-14T21:30:00-04:00"), schoolNights, zone)).toBe(true);
    expect(inRecurringWindow(at("2026-09-14T02:00:00-04:00"), schoolNights, zone)).toBe(false);
  });

  it("ignores days the window does not start on", () => {
    expect(inRecurringWindow(at("2026-09-13T22:00:00-04:00"), schoolNights, zone)).toBe(false);
  });

  it("treats same-day windows as half-open", () => {
    const lunch = { enabled: true, days: [1], start: "12:00", end: "13:00" };
    expect(inRecurringWindow(at("2026-09-14T12:00:00-04:00"), lunch, zone)).toBe(true);
    expect(inRecurringWindow(at("2026-09-14T13:00:00-04:00"), lunch, zone)).toBe(false);
  });

  it("skips spring-forward local times that do not exist", () => {
    const window = { enabled: true, days: [0], start: "02:15", end: "02:45" };
    expect(inRecurringWindow(at("2026-03-08T07:30:00Z"), window, zone)).toBe(false);
  });

  it("matches both occurrences of a repeated fall-back time", () => {
    const window = { enabled: true, days: [0], start: "01:15", end: "01:45" };
    expect(inRecurringWindow(at("2026-11-01T05:30:00Z"), window, zone)).toBe(true);
    expect(inRecurringWindow(at("2026-11-01T06:30:00Z"), window, zone)).toBe(true);
  });

  it("rejects equal endpoints and enabled schedules with no days", () => {
    expect(() => assertSchedule({ enabled: true, days: [1], start: "21:00", end: "21:00" })).toThrow(
      /same time/,
    );
    expect(() => assertSchedule({ enabled: true, days: [], start: "21:00", end: "07:00" })).toThrow(
      /at least one day/,
    );
  });
});

/**
 * The same rules in zones that break naive date maths: half-hour offsets either side of
 * UTC, a +14 zone across the date line, southern-hemisphere daylight saving and Lord
 * Howe's 30-minute shift. Each expected local time was read from the system tz database
 * (`TZ=<zone> date -d <instant>`), not worked out by hand. CI also runs this suite with
 * the server clock in another zone, so nothing may lean on the server's own time zone.
 */
describe("schedule windows across time zones", () => {
  const schoolNights = { enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" };
  const sundayNight = (start: string, end: string) => ({ enabled: true, days: [0], start, end });

  it.each([
    // Asia/Kolkata, +05:30: Monday 21:29, 21:30; Tuesday 06:44, 06:45.
    ["Asia/Kolkata", "2026-09-14T15:59:00Z", schoolNights, false],
    ["Asia/Kolkata", "2026-09-14T16:00:00Z", schoolNights, true],
    ["Asia/Kolkata", "2026-09-15T01:14:00Z", schoolNights, true],
    ["Asia/Kolkata", "2026-09-15T01:15:00Z", schoolNights, false],
    // America/St_Johns, -02:30: Monday 21:30 locally, already Tuesday in UTC.
    ["America/St_Johns", "2026-09-15T00:00:00Z", schoolNights, true],
    // Pacific/Kiritimati, +14: Monday 21:30 locally is Monday morning in UTC; Sunday 22:00 is not a school night.
    ["Pacific/Kiritimati", "2026-09-14T07:30:00Z", schoolNights, true],
    ["Pacific/Kiritimati", "2026-09-13T08:00:00Z", schoolNights, false],
  ])("%s at %s", (zone, instant, schedule, expected) => {
    expect(inRecurringWindow(at(instant), schedule, zone)).toBe(expected);
  });

  it("matches both 02:30s when Sydney falls back in April", () => {
    const window = sundayNight("02:15", "02:45");
    expect(inRecurringWindow(at("2026-04-04T15:30:00Z"), window, "Australia/Sydney")).toBe(true); // 02:30 AEDT
    expect(inRecurringWindow(at("2026-04-04T16:30:00Z"), window, "Australia/Sydney")).toBe(true); // 02:30 AEST
  });

  it("skips the hour Sydney loses in October, and keeps an overnight window across it", () => {
    const skipped = sundayNight("02:15", "02:45");
    expect(inRecurringWindow(at("2026-10-03T15:59:00Z"), skipped, "Australia/Sydney")).toBe(false); // 01:59 AEST
    expect(inRecurringWindow(at("2026-10-03T16:00:00Z"), skipped, "Australia/Sydney")).toBe(false); // 03:00 AEDT
    expect(inRecurringWindow(at("2026-10-03T16:30:00Z"), skipped, "Australia/Sydney")).toBe(false); // 03:30 AEDT

    const saturdayNight = { enabled: true, days: [6], start: "21:00", end: "07:00" };
    expect(inRecurringWindow(at("2026-10-03T10:00:00Z"), saturdayNight, "Australia/Sydney")).toBe(false); // Sat 20:00
    expect(inRecurringWindow(at("2026-10-03T19:59:00Z"), saturdayNight, "Australia/Sydney")).toBe(true); // Sun 06:59
    expect(inRecurringWindow(at("2026-10-03T20:00:00Z"), saturdayNight, "Australia/Sydney")).toBe(false); // Sun 07:00
  });

  it("follows Lord Howe's 30-minute daylight saving shift both ways", () => {
    // October: 02:00 becomes 02:30, so a 02:00-02:30 window never happens.
    const lost = sundayNight("02:00", "02:30");
    expect(inRecurringWindow(at("2026-10-03T15:29:00Z"), lost, "Australia/Lord_Howe")).toBe(false); // 01:59
    expect(inRecurringWindow(at("2026-10-03T15:30:00Z"), lost, "Australia/Lord_Howe")).toBe(false); // 02:30
    expect(inRecurringWindow(at("2026-10-03T15:40:00Z"), sundayNight("02:15", "02:45"), "Australia/Lord_Howe")).toBe(true); // 02:40
    // April: 01:30-02:00 happens twice.
    const repeated = sundayNight("01:40", "01:50");
    expect(inRecurringWindow(at("2026-04-04T14:45:00Z"), repeated, "Australia/Lord_Howe")).toBe(true); // 01:45 +11
    expect(inRecurringWindow(at("2026-04-04T15:15:00Z"), repeated, "Australia/Lord_Howe")).toBe(true); // 01:45 +10:30
  });

  it("matches both 01:30s when London falls back", () => {
    const window = sundayNight("01:15", "01:45");
    expect(inRecurringWindow(at("2026-10-25T00:30:00Z"), window, "Europe/London")).toBe(true); // 01:30 BST
    expect(inRecurringWindow(at("2026-10-25T01:30:00Z"), window, "Europe/London")).toBe(true); // 01:30 GMT
  });
});

describe("protection and pause", () => {
  const bedtime = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: "21:00", end: "07:00" };
  const now = at("2026-09-14T22:10:00-04:00");

  it("does not block protected groups", () => {
    expect(
      isDesiredBlocked({
        protected: true,
        schedule: bedtime,
        suspension: { active: false, until: null },
        now,
        timezone: zone,
      }),
    ).toBe(false);
  });

  it("pause suspends schedule enforcement", () => {
    expect(
      isDesiredBlocked({
        protected: false,
        schedule: bedtime,
        suspension: { active: true, until: at("2026-09-14T23:00:00-04:00") },
        now,
        timezone: zone,
      }),
    ).toBe(false);
  });

  it("expired pause restores the schedule", () => {
    expect(
      isDesiredBlocked({
        protected: false,
        schedule: bedtime,
        suspension: { active: true, until: at("2026-09-14T22:00:00-04:00") },
        now,
        timezone: zone,
      }),
    ).toBe(true);
  });

  it("extends from the later of now and the existing expiry", () => {
    const existing = at("2026-09-14T23:00:00-04:00");
    const extended = extendSuspensionUntil(existing, now, 60 * 60 * 1000);
    expect(extended.toISOString()).toBe("2026-09-15T04:00:00.000Z");
  });
});
