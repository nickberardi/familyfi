import { describe, expect, it } from "vitest";
import {
  assertSchedule,
  extendSuspensionUntil,
  isSuspended,
} from "@/lib/schedule";

function at(isoLocalish: string): Date {
  return new Date(isoLocalish);
}

describe("schedules", () => {
  it("rejects times that are not HH:MM and days outside Sunday to Saturday", () => {
    expect(() => assertSchedule({ enabled: true, days: [1], start: "9pm", end: "07:00" })).toThrow(/HH:MM/);
    expect(() => assertSchedule({ enabled: true, days: [1], start: "24:00", end: "07:00" })).toThrow(/HH:MM/);
    expect(() => assertSchedule({ enabled: true, days: [7], start: "21:00", end: "07:00" })).toThrow(/0 \(Sunday\) through 6/);
    expect(() => assertSchedule({ enabled: true, days: [1.5], start: "21:00", end: "07:00" })).toThrow(/0 \(Sunday\) through 6/);
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

describe("pause", () => {
  const now = at("2026-09-14T22:10:00-04:00");

  it("is paused while active and before its end, or with no end", () => {
    expect(isSuspended({ active: false, until: null }, now)).toBe(false);
    expect(isSuspended({ active: true, until: null }, now)).toBe(true);
    expect(isSuspended({ active: true, until: at("2026-09-14T23:00:00-04:00") }, now)).toBe(true);
    // A pause that has run out no longer counts, even before reconciliation clears it.
    expect(isSuspended({ active: true, until: at("2026-09-14T22:00:00-04:00") }, now)).toBe(false);
  });

  it("extends a pause with no end, or one already over, from now", () => {
    const hour = 60 * 60 * 1000;
    expect(extendSuspensionUntil(null, now, hour).toISOString()).toBe("2026-09-15T03:10:00.000Z");
    expect(extendSuspensionUntil(at("2026-09-14T21:00:00-04:00"), now, hour).toISOString()).toBe("2026-09-15T03:10:00.000Z");
  });

  it("extends from the later of now and the existing expiry", () => {
    const existing = at("2026-09-14T23:00:00-04:00");
    const extended = extendSuspensionUntil(existing, now, 60 * 60 * 1000);
    expect(extended.toISOString()).toBe("2026-09-15T04:00:00.000Z");
  });
});
