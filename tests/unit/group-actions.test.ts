import { describe, expect, it, vi } from "vitest";
import { runGroupCardAction } from "@/lib/group-writes";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { groupCardControls } from "@/ui/group-card-controls";

/* The labels and states are pinned by tests/fixtures/display-vectors.json; this checks the wiring. */

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    kind: "things",
    name: "TV",
    monogram: "TV",
    familyRole: null,
    deviceCount: 3,
    suspension: { active: false, until: null, by: null },
    allowance: { active: false, until: null, by: null },
    internetRuleIds: ["r-downtime"],
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: "r",
    name: "Rule",
    kind: "internet",
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

const TZ = "America/New_York";
// Thursday 4:30 PM in New York: Video blocks until 6, Dinner starts at 6.
const NOW = new Date("2026-10-15T20:30:00Z");
const downtime = rule({ id: "r-downtime", name: "TV downtime", windows: [{ id: "w1", name: "Dinner", days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "20:00" }] });
const video = rule({ id: "r-video", name: "TV video evenings", kind: "category", targetIds: [4], windows: [{ id: "w2", name: "", days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" }] });
describe("groupCardControls", () => {
  it("gives the group one button, its tap naming what it is for", () => {
    const onRun = vi.fn();
    const controls = groupCardControls(group(), [downtime, video], TZ, NOW, onRun);
    expect(controls.action).toMatchObject({ label: "Unblock", strong: true, testID: "group-action-unblock-g1" });
    expect(controls.more).toBeNull();
    controls.action.onPress();
    expect(onRun.mock.calls.map(([tap]) => tap)).toEqual([{ kind: "header", run: "unblock" }]);
  });

  it("disables the button while the view is stale", () => {
    expect(groupCardControls(group(), [downtime], TZ, NOW, vi.fn(), false).action.disabled).toBe(true);
  });
});

describe("runGroupCardAction", () => {
  it("opens a sheet for Block, Unblock, Pause and More time, and writes Resume at once", () => {
    const mutate = vi.fn(() => Promise.resolve(undefined));
    const openSheet = vi.fn();
    const tv = group();
    for (const run of ["block", "moreBlock", "unblock", "moreUnblock"] as const) runGroupCardAction(mutate, tv, { kind: "header", run }, openSheet);
    runGroupCardAction(mutate, tv, { kind: "rule", run: "pause", ruleIds: ["r-video"], name: "Video" }, openSheet);
    runGroupCardAction(mutate, tv, { kind: "rule", run: "extend", ruleIds: ["r-video"], name: "Video" }, openSheet);
    expect(openSheet.mock.calls.map(([target]) => target)).toEqual([
      { kind: "block", mode: "pause" },
      { kind: "block", mode: "extend" },
      { kind: "unblock", mode: "pause" },
      { kind: "unblock", mode: "extend" },
      { kind: "rule", ruleIds: ["r-video"], name: "Video", mode: "pause" },
      { kind: "rule", ruleIds: ["r-video"], name: "Video", mode: "extend" },
    ]);
    expect(mutate).not.toHaveBeenCalled();

    runGroupCardAction(mutate, tv, { kind: "header", run: "resume" }, openSheet);
    runGroupCardAction(mutate, tv, { kind: "header", run: "unblockNow" }, openSheet);
    runGroupCardAction(mutate, tv, { kind: "rule", run: "resume", ruleIds: ["r-video"], name: "Video" }, openSheet);
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(openSheet).toHaveBeenCalledTimes(6);
  });
});
