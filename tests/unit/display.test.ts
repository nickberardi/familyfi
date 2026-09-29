import { describe, expect, it } from "vitest";
import {
  bedtimeEndDays,
  cardNoteLine,
  cardStateLabel,
  daysLabel,
  deviceKindLabel,
  deviceIcon,
  formatHhmm,
  nextClockOnDays,
  windowTimes,
} from "@/lib/display";
import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";

const TZ = "America/New_York";
const bedtime: InternetWindow = { name: "Bedtime", days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45", ruleName: "Bedtime" };

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    kind: "family",
    name: "Betsy",
    monogram: null,
    familyRole: "child",
    deviceCount: 4,
    suspension: { active: false, until: null, by: null },
    allowance: { active: false, until: null, by: null },
    internetRuleIds: ["r1"],
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

describe("schedule copy", () => {
  it("formats windows and their days", () => {
    expect(formatHhmm("21:30")).toBe("9:30 PM");
    expect(windowTimes("21:30", "06:45")).toBe("9:30 PM–6:45 AM");
    expect(daysLabel([5, 4, 3, 2, 1])).toBe("Mon–Fri");
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(daysLabel([0, 3])).toBe("Sun, Wed");
  });

  it("counts internet windows on the note line, or says there is no internet rule", () => {
    expect(cardNoteLine(group(), [bedtime])).toBe("4 devices · 1 internet window");
    expect(cardNoteLine(group({ internetRuleIds: [] }), [])).toBe("4 devices · no internet rule");
    expect(cardNoteLine(group({ deviceCount: 0 }), [bedtime])).toBe("No devices · rules cannot apply on UniFi until you assign one");
  });

  it("names the scope, the source and who in the state phrase", () => {
    const monday7pm = new Date("2026-09-14T19:00:00-04:00");
    const paused = group({ access: "paused", suspension: { active: true, until: "2026-09-14T20:00:00-04:00", by: { accountId: "a", name: "Nick" } } });
    expect(cardStateLabel(paused, [bedtime], TZ, monday7pm)).toBe("All internet paused until 8:00 PM by Nick");
    expect(cardStateLabel(group(), [bedtime], TZ, monday7pm)).toBe("Online · Bedtime at 9:30 PM");
    expect(cardStateLabel(group(), [bedtime], TZ, new Date("2026-09-14T22:00:00-04:00"))).toBe("No internet · Bedtime until 6:45 AM");
    const allowed = group({ allowance: { active: true, until: "2026-09-15T06:45:00-04:00", by: { accountId: "a", name: "Nick" } } });
    expect(cardStateLabel(allowed, [bedtime], TZ, new Date("2026-09-14T22:00:00-04:00"))).toBe("Online · allowed until 6:45 AM by Nick");
    expect(cardStateLabel(group({ internetRuleIds: [] }), [], TZ, monday7pm)).toBe("Online · no internet rule");
    // An always-on internet rule has no end to name.
    const grounded = { name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "00:00", always: true, ruleName: "Grounded" };
    expect(cardStateLabel(group(), [grounded], TZ, monday7pm)).toBe("No internet · Grounded · always");
    expect(cardNoteLine(group(), [grounded])).toBe("4 devices · internet off always");
  });
});

describe("window ends", () => {
  it("maps overnight windows to the morning the off period ends", () => {
    expect([...bedtimeEndDays([1, 2, 3, 4, 5], "21:30", "06:45")].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
  });

  it("finds the next clock time on selected days", () => {
    const hit = nextClockOnDays(TZ, [1], "21:30", new Date("2026-09-14T12:00:00-04:00"));
    expect(hit?.toISOString()).toBe(new Date("2026-09-14T21:30:00-04:00").toISOString());
  });
});

describe("device marks", () => {
  it("maps common hostnames to a kind and its glyph", () => {
    expect(deviceKindLabel("Abby's iPhone")).toBe("Phone");
    expect(deviceIcon("Abby's iPhone")).toBe("device-mobile");
    expect(deviceKindLabel("Living Room Apple TV")).toBe("TV");
    expect(deviceIcon("Living Room Apple TV")).toBe("television");
    expect(deviceIcon("Nick's MacBook")).toBe("laptop");
    expect(deviceIcon("Echo — kitchen")).toBe("speaker-high");
  });

  /* The table is ordered, and the order is the whole of how these two resolve. */
  it("reads an Apple TV as a television, not as a Mac", () => {
    expect(deviceKindLabel("Apple TV — playroom")).toBe("TV");
    expect(deviceIcon("Apple TV — playroom")).toBe("television");
  });

  it("places the device names a household actually types", () => {
    expect(deviceKindLabel("Guest Laptop")).toBe("Computer");
    expect(deviceKindLabel("Schoolroom Chromebook")).toBe("Computer");
    expect(deviceKindLabel("EPSON ET-3830")).toBe("Printer");
    expect(deviceKindLabel("Basement Sonos")).toBe("Speaker");
    expect(deviceKindLabel("Playroom Xbox")).toBe("Console");
    expect(deviceKindLabel("Living room AP")).toBe("Network");
  });

  /*
   * An arrival we cannot place is the common case on the Devices page, and it must
   * not borrow another type's glyph: a wrong icon reads as a fact about the device.
   */
  it("falls back to the unknown glyph rather than guessing a type", () => {
    expect(deviceKindLabel("Unknown")).toBe("Device");
    expect(deviceIcon("Unknown")).toBe("question");
    expect(deviceIcon(null)).toBe("question");
  });
});
