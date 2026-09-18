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
