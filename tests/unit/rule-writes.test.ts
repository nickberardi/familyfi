import { describe, expect, it } from "vitest";
import { overlapNotices, ruleWritePlan, type RuleDraft } from "@/lib/rule-writes";
import { internetRulePresets, internetWindowsForGroup, ruleBlocksLabel, ruleDayBands, windowSegments, type Rule } from "@/lib/rules";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const saved: RuleDraft = {
  id: "rule-abcd",
  name: "TV downtime",
  useGeneratedName: false,
  kind: "internet",
  targetIds: [],
  domains: [],
  groupIds: ["tv"],
  mode: "scheduled",
  windows: [
    { id: "w1", name: "Dinner", days: EVERY_DAY, start: "18:00", end: "20:00" },
    { id: "w2", name: "Overnight", days: EVERY_DAY, start: "23:00", end: "07:00" },
  ],
};

describe("ruleWritePlan", () => {
  it("creates one policy per window for a new rule", () => {
    expect(ruleWritePlan(null, saved)).toEqual([
      { verb: "NEW", name: "FamilyFi TV downtime – Dinner", detail: "6 PM–8 PM · Every day" },
      { verb: "NEW", name: "FamilyFi TV downtime – Overnight", detail: "11 PM–7 AM · Every day" },
    ]);
  });

  it("keeps unchanged policies and renames in place", () => {
    expect(ruleWritePlan(saved, saved).map((write) => write.verb)).toEqual(["KEEP", "KEEP"]);
    const renamed = { ...saved, name: "Screens off" };
    expect(ruleWritePlan(saved, renamed)[0]).toEqual({
      verb: "CHANGE",
      name: "FamilyFi Screens off – Dinner",
      detail: "Renamed from “FamilyFi TV downtime – Dinner”",
    });
  });

  it("changes a window's times, deletes a removed window and adds a new one", () => {
    const edited = {
      ...saved,
      groupIds: ["tv", "den"],
      windows: [
        { ...saved.windows[0]!, start: "17:30", days: [1, 2, 3, 4, 5] },
        { name: "Lunch", days: [0, 6], start: "12:00", end: "13:00" },
      ],
    };
    expect(ruleWritePlan(saved, edited)).toEqual([
      { verb: "CHANGE", name: "FamilyFi TV downtime – Dinner", detail: "Schedule 6 PM–8 PM → 5:30 PM–8 PM, Mon–Fri · Groups changed" },
      { verb: "NEW", name: "FamilyFi TV downtime – Lunch", detail: "12 PM–1 PM · Weekends" },
      { verb: "DELETE", name: "FamilyFi TV downtime – Overnight", detail: "Window removed · its time comes back online" },
    ]);
  });

  it("names the one remaining window's policy after the rule", () => {
    const single = { ...saved, windows: [saved.windows[1]!] };
    expect(ruleWritePlan(saved, single)).toEqual([
      { verb: "CHANGE", name: "FamilyFi TV downtime", detail: "Renamed from “FamilyFi TV downtime – Overnight”" },
      { verb: "DELETE", name: "FamilyFi TV downtime – Dinner", detail: "Window removed · its time comes back online" },
    ]);
  });

  it("swaps between always and scheduled", () => {
    const video = { ...saved, kind: "category" as const, name: "Video", targetIds: [4] };
    const always = { ...video, mode: "always" as const, windows: [] };
    expect(ruleWritePlan(video, always)).toEqual([
      { verb: "NEW", name: "FamilyFi Video", detail: "Always on" },
      { verb: "DELETE", name: "FamilyFi Video – Dinner", detail: "Replaced by the always-on policy" },
      { verb: "DELETE", name: "FamilyFi Video – Overnight", detail: "Replaced by the always-on policy" },
    ]);
    expect(ruleWritePlan(always, video)[0]).toEqual({ verb: "DELETE", name: "FamilyFi Video", detail: "Replaced by scheduled windows" });
    expect(ruleWritePlan(always, { ...always, targetIds: [24] })).toEqual([{ verb: "CHANGE", name: "FamilyFi Video", detail: "Blocks changed" }]);
  });
});

describe("overlapNotices", () => {
  it("names each pair of windows that overlap", () => {
    const chores = { name: "", days: [1, 2, 3, 4, 5], start: "17:00", end: "19:00" };
    const homework = { name: "Homework", days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00" };
    expect(overlapNotices([homework, chores])).toEqual(["“Homework” and “Window 2” overlap."]);
    expect(overlapNotices([homework])).toEqual([]);
  });
});

describe("client rule helpers", () => {
  const rule = (patch: Partial<Rule>): Rule => ({
    id: "r",
    name: "Rule",
    kind: "internet",
    scope: "group",
    groupIds: ["g1"],
    networkIds: [],
    targetIds: [],
    domains: [],
    enabled: true,
    mode: "scheduled",
    windows: [{ id: "w", name: "", days: EVERY_DAY, start: "22:00", end: "06:00" }],
    useGeneratedName: false,
    policyNames: [],
    ...patch,
  });

  it("collects enabled internet windows for a group, with their rule", () => {
    const rules = [rule({ name: "Bedtime" }), rule({ name: "Off", enabled: false }), rule({ name: "Other", groupIds: ["g2"] }), rule({ name: "Video", kind: "category" })];
    expect(internetWindowsForGroup(rules, "g1")).toEqual([{ id: "w", name: "", days: EVERY_DAY, start: "22:00", end: "06:00", ruleName: "Bedtime" }]);
  });

  it("offers one-tap internet rules to children and teens only", () => {
    const names = (group: { kind: "family" | "things"; familyRole: string | null }) => internetRulePresets(group).map((preset) => preset.name);
    expect(names({ kind: "family", familyRole: "child" })).toEqual(["Bedtime", "Homework"]);
    expect(names({ kind: "family", familyRole: "teen" })).toEqual(["Bedtime", "School nights"]);
    // Adults and things start from a custom schedule.
    expect(names({ kind: "family", familyRole: "adult" })).toEqual([]);
    expect(names({ kind: "family", familyRole: null })).toEqual([]);
    expect(names({ kind: "things", familyRole: null })).toEqual([]);
  });

  it("says what a rule blocks", () => {
    const names = new Map([["app:7", "TikTok"]]);
    expect(ruleBlocksLabel(rule({}), names)).toBe("All internet · every device");
    expect(ruleBlocksLabel(rule({ kind: "category", targetIds: [4] }), names)).toBe("Video only · everything else stays on");
    expect(ruleBlocksLabel(rule({ kind: "app", targetIds: [7, 8] }), names)).toBe("TikTok, App only · everything else stays on");
    expect(ruleBlocksLabel(rule({ kind: "domain", domains: ["a.com", "b.com", "c.com"] }), names)).toBe("3 websites · a.com, b.com…");
    expect(ruleBlocksLabel(rule({ kind: "domain", domains: ["a.com"] }), names)).toBe("1 website · a.com");
  });

  it("draws a rule's windows on a bar", () => {
    expect(windowSegments({ start: "22:00", end: "06:00" })).toEqual([{ from: 1320, to: 1440 }, { from: 0, to: 360 }]);
    expect(windowSegments({ start: "15:00", end: "18:00" })).toEqual([{ from: 900, to: 1080 }]);
    expect(windowSegments({ start: "15:00", end: "15:00" })).toEqual([]);
    expect(ruleDayBands(rule({ mode: "always", windows: [] }), 1)).toEqual([expect.objectContaining({ from: 0, to: 1440 })]);
    expect(ruleDayBands(rule({}), 1).map((band) => [band.from, band.to])).toEqual([[0, 360], [1320, 1440]]);
  });
});
