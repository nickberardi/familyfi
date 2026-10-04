import { describe, expect, it } from "vitest";
import { nextClockOnDays, zonedWallTimeToUtc } from "@/lib/clock";
import { nextWindowStart, windowEndsAt } from "@/lib/rule-windows";

/**
 * Wall-clock times on the days clocks change. Each expected instant was read from the
 * system tz database (`TZ=<zone> date -d <instant>`), not worked out by hand.
 */
const NEW_YORK = "America/New_York";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const at = (iso: string) => new Date(iso).toISOString();

describe("zonedWallTimeToUtc", () => {
  it.each([
    ["the day New York springs forward", NEW_YORK, [2026, 3, 8, 3, 0], "2026-03-08T07:00:00Z"], // 03:00 EDT
    ["the day New York falls back", NEW_YORK, [2026, 11, 1, 3, 0], "2026-11-01T08:00:00Z"], // 03:00 EST
    ["the evening New York sprang forward", NEW_YORK, [2026, 3, 8, 21, 30], "2026-03-09T01:30:00Z"], // 21:30 EDT
    ["the day London springs forward", "Europe/London", [2026, 3, 29, 3, 0], "2026-03-29T02:00:00Z"], // 03:00 BST
    ["the day Sydney springs forward", "Australia/Sydney", [2026, 10, 4, 3, 30], "2026-10-03T16:30:00Z"], // 03:30 AEDT
  ] as const)("reads a clock time on %s", (_day, zone, [year, month, day, hour, minute], expected) => {
    expect(zonedWallTimeToUtc(zone, year, month, day, hour, minute).toISOString()).toBe(at(expected));
  });

  it("takes the first of a time that happens twice", () => {
    expect(zonedWallTimeToUtc(NEW_YORK, 2026, 11, 1, 1, 30).toISOString()).toBe(at("2026-11-01T05:30:00Z")); // 01:30 EDT
    expect(zonedWallTimeToUtc("Australia/Lord_Howe", 2026, 4, 5, 1, 45).toISOString()).toBe(at("2026-04-04T14:45:00Z")); // 01:45 +11
  });

  it("moves a time the clocks skip forward by the jump", () => {
    expect(zonedWallTimeToUtc(NEW_YORK, 2026, 3, 8, 2, 30).toISOString()).toBe(at("2026-03-08T07:30:00Z")); // 03:30 EDT
    expect(zonedWallTimeToUtc("Australia/Lord_Howe", 2026, 10, 4, 2, 15).toISOString()).toBe(at("2026-10-03T15:45:00Z")); // 02:45 +11
  });
});

describe("nextClockOnDays across a clock change", () => {
  it("finds 03:00 on the night New York springs forward", () => {
    // Sunday 00:00 EST; 03:00 that morning is EDT.
    expect(nextClockOnDays(NEW_YORK, EVERY_DAY, "03:00", new Date("2026-03-08T05:00:00Z"))?.toISOString())
      .toBe(at("2026-03-08T07:00:00Z"));
  });

  it("finds 03:00 on the night New York falls back", () => {
    // Sunday 00:00 EDT; 03:00 that morning is EST.
    expect(nextClockOnDays(NEW_YORK, EVERY_DAY, "03:00", new Date("2026-11-01T04:00:00Z"))?.toISOString())
      .toBe(at("2026-11-01T08:00:00Z"));
  });
});

describe("rule windows across a clock change", () => {
  const saturdayNight = { name: "", days: [6], start: "21:00", end: "03:00" };
  const sundayEarly = { name: "", days: [0], start: "04:00", end: "08:00" };

  it("ends an overnight window at 03:00 local when New York springs forward", () => {
    // Sunday 01:00 EST, inside the window.
    expect(windowEndsAt(saturdayNight, new Date("2026-03-08T06:00:00Z"), NEW_YORK)?.toISOString())
      .toBe(at("2026-03-08T07:00:00Z")); // 03:00 EDT
  });

  it("ends an overnight window at 03:00 local when New York falls back", () => {
    // Sunday 00:30 EDT, inside the window.
    expect(windowEndsAt(saturdayNight, new Date("2026-11-01T04:30:00Z"), NEW_YORK)?.toISOString())
      .toBe(at("2026-11-01T08:00:00Z")); // 03:00 EST
  });

  it("starts a window at 04:00 local on the morning New York falls back", () => {
    // Sunday 00:00 EDT.
    expect(nextWindowStart(sundayEarly, new Date("2026-11-01T04:00:00Z"), NEW_YORK)?.toISOString())
      .toBe(at("2026-11-01T09:00:00Z")); // 04:00 EST
  });
});
