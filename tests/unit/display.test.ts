import { describe, expect, it } from "vitest";
import {
  bedtimeEndDays,
  cardNoteLine,
  cardStateLabel,
  canPauseGroup,
  dayCaption,
  deviceKindLabel,
  deviceIcon,
  formatHhmm,
  nextBedtimeResumeAt,
  nextClockOnDays,
  scheduleCaption,
} from "@/lib/display";
import type { Group } from "@/lib/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    kind: "family",
    name: "Betsy",
    monogram: null,
    familyRole: "child",
    protected: false,
    mode: "scheduled",
    deviceCount: 4,
    schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" },
    suspension: { active: false, until: null },
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

describe("schedule copy", () => {
  it("formats school-night bedtime on the note line", () => {
    expect(formatHhmm("21:30")).toBe("9:30 PM");
    expect(dayCaption([1, 2, 3, 4, 5])).toBe("school nights");
    expect(scheduleCaption(group())).toBe("off 9:30 PM–6:45 AM, school nights");
    expect(cardNoteLine(group())).toBe("4 devices · off 9:30 PM–6:45 AM, school nights");
    expect(cardNoteLine(group({ deviceCount: 0 }))).toBe(
      "No devices · bedtime cannot apply on UniFi until you assign one",
    );
  });

  it("puts pause expiry in the state phrase", () => {
    expect(
      cardStateLabel(
        group({
          dohOverrideUrl: null,
          access: "paused",
          suspension: { active: true, until: "2026-09-14T20:00:00-04:00" },
        }),
        "America/New_York",
      ),
    ).toBe("Paused until 8:00 PM");
  });
});

describe("pause eligibility", () => {
  it("hides Pause for adults, protected groups, and groups with no schedule", () => {
    expect(canPauseGroup(group({ familyRole: "adult" }))).toBe(false);
    expect(canPauseGroup(group({ protected: true }))).toBe(false);
    expect(canPauseGroup(group({ schedule: { enabled: false, days: [], start: null, end: null } }))).toBe(false);
    expect(canPauseGroup(group())).toBe(true);
  });
});

describe("until bedtime", () => {
  it("maps overnight windows to the morning the off period ends", () => {
    expect([...bedtimeEndDays([1, 2, 3, 4, 5], "21:30", "06:45")].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
  });

  it("returns the next 6:45 AM after Monday evening", () => {
    const now = new Date("2026-09-14T19:00:00-04:00");
    const resume = nextBedtimeResumeAt(group(), "America/New_York", now);
    expect(resume).not.toBeNull();
    expect(resume?.toISOString()).toBe(new Date("2026-09-15T06:45:00-04:00").toISOString());
  });

  it("finds the next clock time on selected days", () => {
    const hit = nextClockOnDays("America/New_York", [1], "21:30", new Date("2026-09-14T12:00:00-04:00"));
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

describe("always mode", () => {
  it("labels Always On when access is always_on", () => {
    expect(cardStateLabel(group({ mode: "always", schedule: { enabled: false, days: [], start: null, end: null }, access: "always_on" }), "America/New_York")).toBe(
      "Always On · Internet blocked",
    );
  });

  it("allows Pause without a bedtime schedule in Always mode", () => {
    expect(
      canPauseGroup(
        group({
          mode: "always",
          schedule: { enabled: false, days: [], start: null, end: null },
          dohOverrideUrl: null,
          access: "always_on",
        }),
      ),
    ).toBe(true);
  });

  it("captions Always On", () => {
    expect(scheduleCaption(group({ mode: "always", schedule: { enabled: false, days: [], start: null, end: null } }))).toBe("Always On");
  });
});
