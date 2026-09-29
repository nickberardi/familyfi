import { describe, expect, it } from "vitest";
import {
  internetDayBands,
  internetState,
  isWindowActive,
  nextWindowStart,
  windowDayBands,
  windowEndsAt,
  windowOverlaps,
  type InternetGroup,
  type InternetWindow,
} from "@/lib/rule-windows";

const TZ = "America/New_York";
// Monday 28 September 2026 is EDT, UTC−4.
const at = (local: string) => new Date(`${local}-04:00`);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

const bedtime: InternetWindow = { name: "", days: EVERY_DAY, start: "22:00", end: "06:00", ruleName: "Bedtime" };
const homework: InternetWindow = { name: "Homework", days: WEEKDAYS, start: "15:00", end: "18:00", ruleName: "School days" };

const group = (patch: Partial<InternetGroup> = {}): InternetGroup => ({
  suspension: { active: false, until: null, by: null },
  allowance: { active: false, until: null, by: null },
  ...patch,
});

describe("rule windows", () => {
  it("is active across midnight on the day it started", () => {
    const fridayOnly = { ...bedtime, days: [5] };
    expect(isWindowActive(fridayOnly, at("2026-10-02T23:00:00"), TZ)).toBe(true);
    expect(isWindowActive(fridayOnly, at("2026-10-03T05:59:00"), TZ)).toBe(true);
    expect(isWindowActive(fridayOnly, at("2026-10-03T06:00:00"), TZ)).toBe(false);
    expect(isWindowActive(fridayOnly, at("2026-10-03T23:00:00"), TZ)).toBe(false);
  });

  it("ends the occurrence active now, and is null when inactive", () => {
    expect(windowEndsAt(bedtime, at("2026-09-28T23:30:00"), TZ)).toEqual(at("2026-09-29T06:00:00"));
    expect(windowEndsAt(homework, at("2026-09-28T16:00:00"), TZ)).toEqual(at("2026-09-28T18:00:00"));
    expect(windowEndsAt(homework, at("2026-09-27T16:00:00"), TZ)).toBeNull();
  });

  it("finds the next start on the window's days", () => {
    // Saturday afternoon: homework is next on Monday.
    expect(nextWindowStart(homework, at("2026-10-03T16:00:00"), TZ)).toEqual(at("2026-10-05T15:00:00"));
  });

  it("draws last night's bedtime tail on today's bar", () => {
    expect(windowDayBands(bedtime, 1)).toEqual([
      { from: 0, to: 360, carried: true },
      { from: 1320, to: 1440, carried: false },
    ]);
    // A Friday-only bedtime shows its tail on Saturday and nothing on Sunday.
    expect(windowDayBands({ ...bedtime, days: [5] }, 6)).toEqual([{ from: 0, to: 360, carried: true }]);
    expect(windowDayBands({ ...bedtime, days: [5] }, 0)).toEqual([]);
    expect(windowDayBands(homework, 0)).toEqual([]);
  });

  it("reports windows that block at the same time on some day", () => {
    const lateHomework = { ...homework, start: "17:00", end: "19:00", days: [5] };
    const sundayNight = { ...bedtime, days: [0] };
    const mondayMorning = { ...homework, start: "05:00", end: "08:00", days: [1] };
    expect(windowOverlaps([homework, lateHomework, bedtime])).toEqual([[0, 1]]);
    // Sunday 22:00–Monday 06:00 meets Monday 05:00–08:00.
    expect(windowOverlaps([sundayNight, mondayMorning])).toEqual([[0, 1]]);
    // Saturday 22:00 wraps past the end of the week into Sunday morning.
    expect(windowOverlaps([{ ...bedtime, days: [6] }, { ...homework, start: "05:00", end: "07:00", days: [0] }])).toEqual([[0, 1]]);
    expect(windowOverlaps([homework, { ...homework, days: [0, 6] }])).toEqual([]);
  });
});

describe("internetState", () => {
  it("has no rule when no internet window applies", () => {
    expect(internetState(group(), [], at("2026-09-28T12:00:00"), TZ)).toEqual({ state: "no_rule" });
  });

  it("names the next window while online, and the active one while blocked", () => {
    expect(internetState(group(), [bedtime, homework], at("2026-09-28T12:00:00"), TZ)).toEqual({
      state: "online",
      next: { window: "Homework", at: at("2026-09-28T15:00:00").toISOString() },
    });
    expect(internetState(group(), [bedtime, homework], at("2026-09-29T02:00:00"), TZ)).toEqual({
      state: "blocked",
      window: "Bedtime",
      until: at("2026-09-29T06:00:00").toISOString(),
    });
  });

  it("blocks until the last overlapping window ends", () => {
    const late = { ...homework, name: "Chores", start: "17:00", end: "19:00" };
    expect(internetState(group(), [homework, late], at("2026-09-28T17:30:00"), TZ)).toMatchObject({
      state: "blocked",
      window: "Chores",
      until: at("2026-09-28T19:00:00").toISOString(),
    });
  });

  it("lets a pause win over everything, and an allowance lift the windows", () => {
    const by = { accountId: "a1", name: "Nick" };
    const paused = group({ suspension: { active: true, until: null, by } });
    expect(internetState(paused, [], at("2026-09-28T12:00:00"), TZ)).toEqual({ state: "paused", until: null, by });
    const allowed = group({ allowance: { active: true, until: at("2026-09-28T18:00:00").toISOString(), by } });
    expect(internetState(allowed, [homework], at("2026-09-28T16:00:00"), TZ)).toEqual({
      state: "allowed",
      window: "Homework",
      until: at("2026-09-28T18:00:00").toISOString(),
      by,
    });
    // Once the allowance has run out the window blocks again.
    expect(internetState(allowed, [homework], at("2026-09-28T18:00:00"), TZ).state).toBe("online");
  });
});

describe("an always-on internet rule", () => {
  const grounded: InternetWindow = { name: "", days: EVERY_DAY, start: "00:00", end: "00:00", always: true, ruleName: "Grounded" };

  it("blocks with no end, outlasting a window that ends, until an allowance lifts it", () => {
    const noon = at("2026-09-28T16:00:00");
    expect(internetState(group(), [homework, grounded], noon, TZ)).toEqual({ state: "blocked", window: "Grounded", until: null });
    const allowed = group({ allowance: { active: true, until: null, by: null } });
    expect(internetState(allowed, [grounded], noon, TZ)).toMatchObject({ state: "allowed", window: "Grounded", until: null });
  });

  it("fills the whole day on the timeline, and has no start or end to offer", () => {
    expect(internetDayBands(group(), [grounded], at("2026-09-28T12:00:00"), TZ)).toEqual([
      { kind: "window", from: 0, to: 1440, label: "Grounded", source: "Grounded rule", carried: false },
    ]);
    expect(windowEndsAt(grounded, at("2026-09-28T12:00:00"), TZ)).toBeNull();
    expect(nextWindowStart(grounded, at("2026-09-28T12:00:00"), TZ)).toBeNull();
    expect(isWindowActive(grounded, at("2026-09-28T03:00:00"), TZ)).toBe(true);
  });
});

describe("internetDayBands", () => {
  it("shows every window with its source, including last night's bedtime", () => {
    const bands = internetDayBands(group(), [bedtime, homework], at("2026-09-28T12:00:00"), TZ);
    expect(bands).toEqual([
      { kind: "window", from: 0, to: 360, label: "Bedtime", source: "Bedtime rule", carried: true },
      { kind: "window", from: 1320, to: 1440, label: "Bedtime", source: "Bedtime rule", carried: false },
      { kind: "window", from: 900, to: 1080, label: "Homework", source: "School days rule · Homework", carried: false },
    ]);
  });

  it("adds a pause from now to its end, with who paused", () => {
    const paused = group({ suspension: { active: true, until: at("2026-09-28T20:10:00").toISOString(), by: { accountId: "a1", name: "Nick" } } });
    const bands = internetDayBands(paused, [], at("2026-09-28T19:40:00"), TZ);
    expect(bands).toEqual([
      { kind: "pause", from: 1180, to: 1210, label: "Paused", source: "Paused by Nick until 8:10 PM", carried: false },
    ]);
    const indefinite = group({ suspension: { active: true, until: null, by: null } });
    expect(internetDayBands(indefinite, [], at("2026-09-28T19:40:00"), TZ)[0]).toMatchObject({ to: 1440, source: "Paused by someone until resumed" });
  });

  it("adds an allowance over the window it lifts", () => {
    const allowed = group({ allowance: { active: true, until: at("2026-09-28T18:00:00").toISOString(), by: { accountId: "a1", name: "Nick" } } });
    const bands = internetDayBands(allowed, [homework], at("2026-09-28T16:00:00"), TZ);
    expect(bands.at(-1)).toEqual({ kind: "allowance", from: 960, to: 1080, label: "Allowed", source: "Allowed by Nick until 6:00 PM", carried: false });
  });
});
