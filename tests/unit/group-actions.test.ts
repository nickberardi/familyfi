import { describe, expect, it, vi } from "vitest";
import { rulesBlockingGroup } from "@/lib/group-actions";
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
    countries: [],
    blockPrivateRelay: false,
    openDns: [],
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
    const controls = groupCardControls(group({ suspension: { active: true, until: null, by: null } }), [downtime, video], TZ, NOW, onRun);
    expect(controls.action).toMatchObject({ label: "Unblock", strong: true, testID: "group-action-unblock-g1" });
    expect(controls.more).toBeNull();
    controls.action.onPress();
    expect(onRun.mock.calls.map(([tap]) => tap)).toEqual([{ kind: "header", run: "unblock" }]);
  });

  it("shows Unblock while a scheduled category rule blocks part of the group, with Block internet in its dropdown", () => {
    const onRun = vi.fn();
    const controls = groupCardControls(group(), [downtime, video], TZ, NOW, onRun);
    expect(controls.action).toMatchObject({ label: "Unblock", testID: "group-action-unblock-g1" });
    expect(controls.menu.map((item) => [item.label, item.testID])).toEqual([["Block internet", "group-menu-block-g1"]]);
    expect(controls.blockInternet?.testID).toBe("group-menu-block-g1");
    controls.menu[0]!.onPress();
    expect(onRun.mock.calls.map(([tap]) => tap)).toEqual([{ kind: "header", run: "block" }]);
  });

  it("unblocks one rule from its sheet, and blocks a lifted one again at once, from the dropdown", () => {
    const onRun = vi.fn();
    const social = rule({ id: "r-social", name: "No social", kind: "category", targetIds: [5], windows: [{ id: "w3", name: "", days: [1, 2, 3, 4, 5], start: "16:00", end: "19:00" }] });
    const pausedVideo = { ...video, groupPauses: [{ groupId: "g1", pause: { active: true, until: null, kind: "pause" as const, by: null } }] };
    const controls = groupCardControls(group(), [downtime, pausedVideo, social, rule({ id: "r-tiktok", name: "No TikTok", kind: "domain", mode: "always" })], TZ, NOW, onRun);
    expect(controls.action).toMatchObject({ label: "Unblock" });
    expect(controls.menu.map((item) => [item.label, item.testID])).toEqual([
      ["Block internet", "group-menu-block-g1"],
      ["Unblock No TikTok", "group-menu-pause-r-tiktok-g1"],
      ["Block TV video evenings again", "group-menu-resume-r-video-g1"],
    ]);
    controls.menu[1]!.onPress();
    controls.menu[2]!.onPress();
    expect(onRun.mock.calls.map(([tap]) => tap)).toEqual([
      { kind: "rule", run: "pause", ruleIds: ["r-tiktok"], name: "No TikTok", wording: "unblock" },
      { kind: "rule", run: "resume", ruleIds: ["r-video"], name: "TV video evenings", wording: "unblock", liftedUntil: null },
    ]);
  });

  it("disables the button and its dropdown while the view is stale", () => {
    const controls = groupCardControls(group(), [downtime, video], TZ, NOW, vi.fn(), false);
    expect(controls.action.disabled).toBe(true);
    expect(groupCardControls(group(), [downtime], TZ, NOW, vi.fn()).blockInternet).toBeNull();
    expect(controls.menu.every((item) => item.disabled)).toBe(true);
  });
});

describe("Block countries on a group card", () => {
  it("never reads as blocking the group, so Block stays the card's button", () => {
    const countries = rule({ id: "countries", name: "Block countries", kind: "domain", mode: "always", builtIn: "countries", countries: ["KP"] });
    expect(rulesBlockingGroup(group(), [countries], TZ, NOW)).toEqual([]);
    expect(groupCardControls(group(), [countries], TZ, NOW, vi.fn()).action).toMatchObject({ label: "Block" });
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
    runGroupCardAction(mutate, tv, { kind: "rule", run: "pause", ruleIds: ["r-video"], name: "Video", wording: "unblock" }, openSheet);
    expect(openSheet.mock.calls.map(([target]) => target)).toEqual([
      { kind: "block", mode: "pause" },
      { kind: "block", mode: "extend" },
      { kind: "unblock", mode: "pause" },
      { kind: "unblock", mode: "extend" },
      { kind: "rule", ruleIds: ["r-video"], name: "Video", mode: "pause" },
      { kind: "rule", ruleIds: ["r-video"], name: "Video", mode: "extend" },
      { kind: "rule", ruleIds: ["r-video"], name: "Video", mode: "pause", wording: "unblock" },
    ]);
    expect(mutate).not.toHaveBeenCalled();

    runGroupCardAction(mutate, tv, { kind: "header", run: "resume" }, openSheet);
    runGroupCardAction(mutate, tv, { kind: "header", run: "unblockNow" }, openSheet);
    runGroupCardAction(mutate, tv, { kind: "rule", run: "resume", ruleIds: ["r-video"], name: "Video" }, openSheet);
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(openSheet).toHaveBeenCalledTimes(7);
  });
});

describe("Block <rule> again from the card", () => {
  it("resumes the rule for the group at once and says so", () => {
    const mutate = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
    runGroupCardAction(mutate, group(), { kind: "rule", run: "resume", ruleIds: ["r-video"], name: "Video", wording: "unblock", liftedUntil: "2026-10-15T22:00:00.000Z" }, vi.fn());
    const options = mutate.mock.calls[0]![1] as { feedback: { notice: string; action: { label: string; run: (send: unknown) => Promise<unknown> } } };
    expect(options).toMatchObject({ groupId: "g1", feedback: { notice: "Video blocked again for TV.", action: { label: "Undo" } } });
    // Undo lifts the rule for the group again, until it was lifted before.
    const send = vi.fn(() => Promise.resolve({ rule: {}, change: { changeId: "c" } }));
    void options.feedback.action.run(send);
    expect(send).toHaveBeenCalledWith("/api/v1/groups/g1/rules/r-video/pause", { method: "POST", body: { until: "2026-10-15T22:00:00.000Z" } });
    runGroupCardAction(mutate, group(), { kind: "rule", run: "resume", ruleIds: ["r-g"], name: "gaming", wording: "unblock" }, vi.fn());
    expect(mutate.mock.calls[1]![1]).toMatchObject({ feedback: { notice: "Gaming blocked again for TV." } });
  });
});
