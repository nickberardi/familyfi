import { describe, expect, it } from "vitest";
import { groupScheduleRuleRows, groupScheduleRules, groupScheduleToday } from "@/lib/group-schedule";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    kind: "family",
    name: "Sam",
    monogram: "S",
    familyRole: "teen",
    deviceCount: 2,
    suspension: { active: false, until: null, by: null },
    allowance: { active: false, until: null, by: null },
    internetRuleIds: ["r-night"],
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: "r",
    name: "Rule",
    kind: "category",
    scope: "group",
    groupIds: ["g1"],
    networkIds: [],
    targetIds: [],
    domains: [],
    enabled: true,
    pause: { active: false, until: null, kind: "pause", by: null },
    groupPauses: [],
    mode: "scheduled",
    windows: [],
    useGeneratedName: false,
    policyNames: [],
    builtIn: null,
    ...overrides,
  };
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const TZ = "America/New_York";
// Thursday 4:30 PM in New York: Homework is blocking.
const NOW = new Date("2026-10-15T20:30:00Z");
const names = new Map<string, string>();
const video = rule({ id: "r-video", name: "Video", targetIds: [4], windows: [{ id: "v1", name: "", days: EVERY_DAY, start: "07:00", end: "08:00" }, { id: "v2", name: "", days: EVERY_DAY, start: "20:00", end: "22:00" }] });
const social = rule({ id: "r-social", name: "Social", targetIds: [24], windows: [{ id: "s1", name: "", days: [1, 2, 3, 4, 5], start: "08:00", end: "15:00" }] });
const homework = rule({ id: "r-homework", name: "Homework", targetIds: [4, 24], windows: [{ id: "h1", name: "", days: EVERY_DAY, start: "16:00", end: "18:00" }] });
const night = rule({ id: "r-night", name: "Overnight", kind: "internet", windows: [{ id: "n1", name: "Overnight", days: EVERY_DAY, start: "22:00", end: "07:00" }] });
const all = [video, social, homework, night];

describe("group schedule", () => {
  it("keeps the internet blue and gives every other rule the next colour", () => {
    const scheduled = groupScheduleRules(group(), all, names);
    expect(scheduled.map(({ rule, title, tone }) => [rule.id, title, tone])).toEqual([
      ["r-video", "Video", 0],
      ["r-social", "Social", 1],
      ["r-homework", "Homework (Video and Social)", 2],
      ["r-night", "Overnight", null],
    ]);
  });

  it("lists today's windows in the order they start, marking the one blocking now", () => {
    const { rows, bands } = groupScheduleToday(group(), all, names, TZ, NOW);
    expect(rows.map((row) => [row.title, row.detail, row.state])).toEqual([
      ["Video", "blocked 7 AM–8 AM", null],
      ["Social", "blocked 8 AM–3 PM", null],
      ["Homework (Video and Social)", "blocked 4 PM–6 PM", "Now"],
      ["Video", "blocked 8 PM–10 PM", null],
      ["Overnight", "no internet 10 PM–7 AM", null],
    ]);
    expect(rows.find((row) => row.live)?.ruleId).toBe("r-homework");
    expect(bands.filter((band) => band.kind === "window").every((band) => band.tone === undefined)).toBe(true);
    expect(bands.find((band) => band.label === "Homework (Video and Social) blocked")?.tone).toBe(2);
  });

  it("dims a rule lifted for the group and says how", () => {
    const paused = { ...homework, groupPauses: [{ groupId: "g1", pause: { active: true, until: "2026-10-15T22:00:00Z", kind: "pause" as const, by: null } }] };
    const { rows, bands } = groupScheduleToday(group(), [video, social, paused, night], names, TZ, NOW);
    const row = rows.find((item) => item.ruleId === "r-homework");
    expect(row).toMatchObject({ live: false, state: "Paused until 6:00 PM" });
    expect(bands.find((band) => band.label.startsWith("Homework"))?.dim).toBe(true);
  });

  it("lists each rule once on the details page with its times, days and Pause", () => {
    const rows = groupScheduleRuleRows(group(), all, names, TZ, NOW);
    expect(rows.map((row) => [row.title, row.times, row.state])).toEqual([
      ["Video", "7 AM–8 AM, 8 PM–10 PM", null],
      ["Social", "8 AM–3 PM · Mon–Fri", null],
      ["Homework (Video and Social)", "4 PM–6 PM", "Now"],
      ["Overnight", "Overnight 10 PM–7 AM", null],
    ]);
    expect(rows[2]?.action?.run).toBe("pause");
  });
});
