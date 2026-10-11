import { describe, expect, it } from "vitest";
import { groupPauseSheet } from "@/lib/group-pause-sheet";
import { householdTimezone } from "@/lib/household-state";
import { pauseSheetBody, pauseSheetCustom, pauseSheetOptions, pauseSheetTitle, withCustomChoices } from "@/lib/pause-sheet";
import type { Group } from "@/lib/types";

const group = {
  id: "group-child",
  kind: "family",
  name: "A child",
  monogram: null,
  familyRole: "child",
  deviceCount: 2,
  suspension: { active: false, until: null, by: null },
  allowance: { active: false, until: null, by: null },
  internetRuleIds: [],
  access: "available",
  dohOverrideUrl: null,
} as Group;

describe("group pause sheet", () => {
  it("names the group's own devices and offers the choices for now", () => {
    const now = new Date("2026-09-28T16:00:00Z");
    const devices = [
      { groupId: "group-child", hostname: "A tablet" },
      { groupId: "other", hostname: "Someone else's phone" },
      { groupId: "group-child", hostname: null },
    ];
    const { title, body, options } = groupPauseSheet(group, [], devices, "pause", "America/New_York", now);
    expect({ title, body, options }).toEqual({
      title: pauseSheetTitle(group, "pause"),
      body: pauseSheetBody(group, "pause", ["A tablet", ""]),
      options: pauseSheetOptions(group, [], "pause", "America/New_York", now),
    });
  });
});

describe("group pause sheet with a custom choice", () => {
  it("offers the device's last custom choice and applies a picked one", () => {
    const now = new Date("2026-09-28T16:00:00Z");
    const recent = { kind: "for", minutes: 180 } as const;
    const sheet = groupPauseSheet(group, [], [], "pause", "America/New_York", now, recent);
    expect(sheet.choices).toEqual(withCustomChoices(sheet.options, pauseSheetCustom(group, recent, "pause", "America/New_York", now)));
    expect(sheet.choices[0]).toMatchObject({ label: "For 3 hours" });
    expect(sheet.custom({ kind: "until", clock: "21:00" })).toEqual(pauseSheetCustom(group, { kind: "until", clock: "21:00" }, "pause", "America/New_York", now));
  });
});

describe("household time zone", () => {
  it("is the household's, or New York's before it loads", () => {
    expect(householdTimezone({ timezone: "Europe/London" })).toBe("Europe/London");
    expect(householdTimezone(null)).toBe("America/New_York");
  });
});
