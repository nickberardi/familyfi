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

/**
 * Recurring windows against real clocks: overnight, half-open ends, days, and zones that
 * break naive date maths (half-hour offsets, +14 across the date line, southern and
 * 30-minute daylight saving). Each expected local time was read from the system tz
 * database (`TZ=<zone> date -d <instant>`), not worked out by hand.
 */
const instant = (iso: string) => new Date(iso);
const NEW_YORK = "America/New_York";

describe("isWindowActive", () => {
  const schoolNights = {
    name: "",
    days: [1, 2, 3, 4, 5],
    start: "21:30",
    end: "06:45",
  };

  it("blocks overnight into the next morning", () => {
    expect(isWindowActive(schoolNights, instant("2026-09-15T02:00:00-04:00"), NEW_YORK)).toBe(true);
    expect(isWindowActive(schoolNights, instant("2026-09-15T06:44:00-04:00"), NEW_YORK)).toBe(true);
    expect(isWindowActive(schoolNights, instant("2026-09-15T06:45:00-04:00"), NEW_YORK)).toBe(false);
    expect(isWindowActive(schoolNights, instant("2026-09-14T21:30:00-04:00"), NEW_YORK)).toBe(true);
    expect(isWindowActive(schoolNights, instant("2026-09-14T02:00:00-04:00"), NEW_YORK)).toBe(false);
  });

  it("ignores days the window does not start on", () => {
    expect(isWindowActive(schoolNights, instant("2026-09-13T22:00:00-04:00"), NEW_YORK)).toBe(false);
  });

  it("treats same-day windows as half-open", () => {
    const lunch = { name: "", days: [1], start: "12:00", end: "13:00" };
    expect(isWindowActive(lunch, instant("2026-09-14T12:00:00-04:00"), NEW_YORK)).toBe(true);
    expect(isWindowActive(lunch, instant("2026-09-14T13:00:00-04:00"), NEW_YORK)).toBe(false);
  });

  it("skips spring-forward local times that do not exist", () => {
    const window = { name: "", days: [0], start: "02:15", end: "02:45" };
    expect(isWindowActive(window, instant("2026-03-08T07:30:00Z"), NEW_YORK)).toBe(false);
  });

  it("matches both occurrences of a repeated fall-back time", () => {
    const window = { name: "", days: [0], start: "01:15", end: "01:45" };
    expect(isWindowActive(window, instant("2026-11-01T05:30:00Z"), NEW_YORK)).toBe(true);
    expect(isWindowActive(window, instant("2026-11-01T06:30:00Z"), NEW_YORK)).toBe(true);
  });

});

/**
 * The same rules in zones that break naive date maths: half-hour offsets either side of
 * UTC, a +14 zone across the date line, southern-hemisphere daylight saving and Lord
 * Howe's 30-minute shift. Each expected local time was read from the system tz database
 * (`TZ=<zone> date -d <instant>`), not worked out by hand. CI also runs this suite with
 * the server clock in another zone, so nothing may lean on the server's own time zone.
 */
describe("isWindowActive across time zones", () => {
  const schoolNights = { name: "", days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" };
  const sundayNight = (start: string, end: string) => ({ name: "", days: [0], start, end });

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
  ])("%s at %s", (zone, iso, schedule, expected) => {
    expect(isWindowActive(schedule, instant(iso), zone)).toBe(expected);
  });

  it("matches both 02:30s when Sydney falls back in April", () => {
    const window = sundayNight("02:15", "02:45");
    expect(isWindowActive(window, instant("2026-04-04T15:30:00Z"), "Australia/Sydney")).toBe(true); // 02:30 AEDT
    expect(isWindowActive(window, instant("2026-04-04T16:30:00Z"), "Australia/Sydney")).toBe(true); // 02:30 AEST
  });

  it("skips the hour Sydney loses in October, and keeps an overnight window across it", () => {
    const skipped = sundayNight("02:15", "02:45");
    expect(isWindowActive(skipped, instant("2026-10-03T15:59:00Z"), "Australia/Sydney")).toBe(false); // 01:59 AEST
    expect(isWindowActive(skipped, instant("2026-10-03T16:00:00Z"), "Australia/Sydney")).toBe(false); // 03:00 AEDT
    expect(isWindowActive(skipped, instant("2026-10-03T16:30:00Z"), "Australia/Sydney")).toBe(false); // 03:30 AEDT

    const saturdayNight = { name: "", days: [6], start: "21:00", end: "07:00" };
    expect(isWindowActive(saturdayNight, instant("2026-10-03T10:00:00Z"), "Australia/Sydney")).toBe(false); // Sat 20:00
    expect(isWindowActive(saturdayNight, instant("2026-10-03T19:59:00Z"), "Australia/Sydney")).toBe(true); // Sun 06:59
    expect(isWindowActive(saturdayNight, instant("2026-10-03T20:00:00Z"), "Australia/Sydney")).toBe(false); // Sun 07:00
  });

  it("follows Lord Howe's 30-minute daylight saving shift both ways", () => {
    // October: 02:00 becomes 02:30, so a 02:00-02:30 window never happens.
    const lost = sundayNight("02:00", "02:30");
    expect(isWindowActive(lost, instant("2026-10-03T15:29:00Z"), "Australia/Lord_Howe")).toBe(false); // 01:59
    expect(isWindowActive(lost, instant("2026-10-03T15:30:00Z"), "Australia/Lord_Howe")).toBe(false); // 02:30
    expect(isWindowActive(sundayNight("02:15", "02:45"), instant("2026-10-03T15:40:00Z"), "Australia/Lord_Howe")).toBe(true); // 02:40
    // April: 01:30-02:00 happens twice.
    const repeated = sundayNight("01:40", "01:50");
    expect(isWindowActive(repeated, instant("2026-04-04T14:45:00Z"), "Australia/Lord_Howe")).toBe(true); // 01:45 +11
    expect(isWindowActive(repeated, instant("2026-04-04T15:15:00Z"), "Australia/Lord_Howe")).toBe(true); // 01:45 +10:30
  });

  it("matches both 01:30s when London falls back", () => {
    const window = sundayNight("01:15", "01:45");
    expect(isWindowActive(window, instant("2026-10-25T00:30:00Z"), "Europe/London")).toBe(true); // 01:30 BST
    expect(isWindowActive(window, instant("2026-10-25T01:30:00Z"), "Europe/London")).toBe(true); // 01:30 GMT
  });
});
