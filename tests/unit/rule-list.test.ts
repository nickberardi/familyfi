import { describe, expect, it } from "vitest";
import { addInternetPreset, runRuleAction, toggleRuleEnabled } from "@/lib/group-writes";
import type { HouseholdStore, MutateOptions } from "@/lib/household-store";
import {
  noRulesFor,
  ruleAppliesTo,
  ruleBarBands,
  ruleCardDimmed,
  ruleHref,
  ruleMarkSpec,
  ruleOpenLabel,
  ruleStatus,
  rulesListView,
  rulesScopeHref,
  ruleToggleNotice,
  ruleWhenLines,
  unruledLine,
} from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

const group = (id: string, name: string, kind: Group["kind"] = "family") => ({ id, name, kind }) as Group;
const groups = [group("g1", "A child"), group("g2", "Cameras", "things"), group("g3", "An adult")];
const rule = (over: Partial<Rule>) =>
  ({
    id: "r1",
    name: "School nights",
    kind: "internet",
    scope: "group",
    enabled: true,
    groupIds: ["g1"],
    networkIds: [],
    targetIds: [],
    domains: [],
    mode: "scheduled",
    windows: [{ id: "w1", name: "Bedtime", days: [0, 1, 2, 3, 4], start: "21:00", end: "07:00" }],
    pause: { active: false, until: null, kind: "pause", by: null },
    groupPauses: [],
    ...over,
  }) as Rule;

describe("the Rules list", () => {
  it("shows every rule, or one group's, and chips for the groups some rule covers", () => {
    const rules = [rule({ id: "r1" }), rule({ id: "r2", groupIds: ["g2"] })];
    const all = rulesListView(rules, groups, null);
    expect(all.scoped).toBeUndefined();
    expect(all.list.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(all.chips.map((item) => item.id)).toEqual(["g1", "g2"]);
    expect(all.unruled).toEqual(["An adult"]);
    expect(all.newHref).toBe("/rules/new");
    const scoped = rulesListView(rules, groups, "g2");
    expect(scoped.scoped?.name).toBe("Cameras");
    expect(scoped.list.map((item) => item.id)).toEqual(["r2"]);
    expect(scoped.newHref).toBe("/rules/new?group=g2");
    expect(rulesListView(rules, groups, "gone").scoped).toBeUndefined();
  });

  it("links to a scope and to a rule", () => {
    expect(rulesScopeHref("g1")).toBe("/rules?group=g1");
    expect(rulesScopeHref(null)).toBe("/rules");
    expect(ruleHref({ id: "r9" })).toBe("/rules/r9");
    // Quarantine cannot be edited: its card opens the devices it holds.
    expect(ruleHref({ id: "quarantine", builtIn: "quarantine" })).toBe("/devices");
  });

  it("shows the built-in quarantine rule only in the full list, covering unassigned devices", () => {
    const quarantine = rule({ id: "quarantine", groupIds: [], mode: "always", windows: [], builtIn: "quarantine" });
    const rules = [quarantine, rule({ id: "r1" })];
    expect(rulesListView(rules, groups, null).list.map((item) => item.id)).toEqual(["quarantine", "r1"]);
    expect(rulesListView(rules, groups, "g1").list.map((item) => item.id)).toEqual(["r1"]);
    expect(ruleAppliesTo(quarantine, groups, [])).toEqual(["Unassigned devices"]);
  });

  it("names who a rule covers, groups or networks, even when one is gone", () => {
    expect(ruleAppliesTo(rule({ groupIds: ["g1", "gone"] }), groups, [])).toEqual(["A child", "Deleted group"]);
    expect(ruleAppliesTo(rule({ scope: "network", networkIds: ["n1", "n2"] }), groups, [{ id: "n1", name: "Kids" }])).toEqual(["Kids", "Network"]);
  });

  it("says when a rule blocks, naming windows only when there are several", () => {
    expect(ruleWhenLines(rule({ mode: "always", windows: [] }))).toEqual([{ key: "always", times: "Always" }]);
    const [only] = ruleWhenLines(rule({}));
    expect(only!.times).not.toContain("Bedtime");
    expect(only!.days).toBeTruthy();
    const two = ruleWhenLines(
      rule({ windows: [{ id: "w1", name: "Bedtime", days: [0], start: "21:00", end: "07:00" }, { id: "w2", name: "", days: [1], start: "15:00", end: "18:00" }] }),
    );
    expect(two[0]!.times.startsWith("Bedtime · ")).toBe(true);
    expect(two[1]!.key).toBe("w2");
    expect(two[1]!.times).not.toContain(" · ");
  });

  it("dims a rule that is off or paused", () => {
    const now = new Date("2026-03-04T15:00:00Z");
    expect(ruleCardDimmed(rule({}), now)).toBe(false);
    expect(ruleCardDimmed(rule({ enabled: false }), now)).toBe(true);
    expect(ruleCardDimmed(rule({ pause: { active: true, until: "2026-03-04T16:00:00Z", kind: "pause", by: null } as never }), now)).toBe(true);
  });

  it("marks all internet with a square globe and narrower rules with a round mark", () => {
    expect(ruleMarkSpec(rule({}))).toEqual({ shape: "square", icon: "globe-simple" });
    expect(ruleMarkSpec(rule({ kind: "app" }))).toEqual({ shape: "round", icon: "app-window" });
    expect(ruleMarkSpec(rule({ kind: "domain" }))).toEqual({ shape: "round", icon: "link-simple" });
    expect(ruleMarkSpec(rule({ kind: "category", targetIds: [-1] }))).toEqual({ shape: "round", icon: "prohibit" });
  });

  it("bars the whole day for an always rule, and splits a window that crosses midnight", () => {
    expect(ruleBarBands({ mode: "always", windows: [] })).toEqual([{ from: 0, to: 1440 }]);
    expect(ruleBarBands({ mode: "scheduled", windows: [{ start: "21:00", end: "07:00" }] })).toEqual([
      { from: 1260, to: 1440 },
      { from: 0, to: 420 },
    ]);
  });

  it("says a group without rules stays online", () => {
    expect(noRulesFor(group("g2", "Cameras", "things"))).toBe("No rules for Cameras yet. Its devices stay online and unfiltered.");
    expect(noRulesFor(group("g1", "A child"))).toContain("Their devices");
    expect(unruledLine(["A", "B"])).toBe("No rules: A, B. They stay online and unfiltered.");
  });
});

function recorder() {
  const sent: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const options: (MutateOptions | undefined)[] = [];
  const mutate: HouseholdStore["mutate"] = async (run, opts) => {
    options.push(opts);
    await run(async (path, init) => {
      sent.push({ path, init });
      return {} as never;
    });
    return undefined;
  };
  return { mutate, sent, options };
}

describe("a rule card's writes", () => {
  it("turns a rule off or on and says so", async () => {
    const { mutate, sent, options } = recorder();
    await toggleRuleEnabled(mutate, { id: "r1", name: "School nights", enabled: true });
    expect(sent).toEqual([{ path: "/api/v1/rules/r1", init: { method: "PATCH", body: { enabled: false } } }]);
    expect(options[0]?.feedback?.notice).toBe("School nights turned off. FamilyFi writes it to the gateway next.");
    expect(ruleToggleNotice({ name: "X", enabled: false })).toMatch(/^X turned on\./);
  });

  it("resumes, allows and ends an allowance", async () => {
    const { mutate, sent } = recorder();
    await runRuleAction(mutate, { id: "r1" }, "resume");
    await runRuleAction(mutate, { id: "r1" }, "allow");
    await runRuleAction(mutate, { id: "r1" }, "disallow");
    expect(sent).toEqual([
      { path: "/api/v1/rules/r1/resume", init: { method: "POST", body: undefined } },
      { path: "/api/v1/rules/r1/allow", init: { method: "POST", body: {} } },
      { path: "/api/v1/rules/r1/disallow", init: { method: "POST", body: undefined } },
    ]);
  });

  it("adds a common internet schedule for a group, named for it", async () => {
    const { mutate, sent, options } = recorder();
    await addInternetPreset(mutate, { id: "g1", name: "A child" }, { name: "Bedtime", label: "Bedtime 9 PM", days: [0, 1], start: "21:00", end: "07:00" });
    expect(sent).toEqual([
      {
        path: "/api/v1/rules",
        init: {
          method: "POST",
          body: { name: "Bedtime", kind: "internet", groupIds: ["g1"], mode: "scheduled", windows: [{ name: "Bedtime", days: [0, 1], start: "21:00", end: "07:00" }] },
        },
      },
    ]);
    expect(options[0]?.feedback?.notice).toBe("Bedtime added for A child. FamilyFi writes it to the gateway next.");
  });
});

describe("a rule's status line", () => {
  const zone = "America/New_York";
  // A Wednesday: 8:00 AM, outside the Bedtime window, and 10:00 PM, inside it.
  const morning = new Date("2026-10-07T12:00:00Z");
  const night = new Date("2026-10-08T02:00:00Z");

  it("says a rule that is off does nothing", () => {
    expect(ruleStatus(rule({ enabled: false }), zone, night)).toEqual({ line: "Off · Not enforced", tone: "muted" });
  });

  it("says a paused or allowed rule's pause, as the card's state line does", () => {
    const until = "2026-10-08T03:30:00Z";
    expect(ruleStatus(rule({ pause: { active: true, until, kind: "pause", by: null } }), zone, night)).toEqual({ line: "Paused until 11:30 PM", tone: "paused" });
    expect(ruleStatus(rule({ pause: { active: true, until, kind: "allow", by: null } }), zone, night).tone).toBe("paused");
  });

  it("says a rule lifted for every group it covers blocks no one, even inside a window", () => {
    const lift = (groupId: string, kind: "pause" | "allow") => ({ groupId, pause: { active: true, until: null, kind, by: null } });
    const both = rule({ groupIds: ["g1", "g2"], groupPauses: [lift("g1", "pause"), lift("g2", "pause")] });
    expect(ruleStatus(both, zone, night)).toEqual({ line: "Paused for every group", tone: "paused" });
    expect(ruleStatus(rule({ groupPauses: [lift("g1", "allow")] }), zone, night).line).toBe("Allowed for every group");
    expect(ruleStatus(rule({ groupIds: ["g1", "g2"], groupPauses: [lift("g1", "pause"), lift("g2", "allow")] }), zone, night).line).toBe(
      "Paused or allowed for every group",
    );
    // Lifted for one group of two, it still blocks the other.
    expect(ruleStatus(rule({ groupIds: ["g1", "g2"], groupPauses: [lift("g1", "pause")] }), zone, night)).toEqual({ line: "On · Blocking now", tone: "danger" });
    // A network rule covers no groups to lift.
    expect(ruleStatus(rule({ scope: "network", groupIds: [], networkIds: ["n1"] }), zone, night).tone).toBe("danger");
  });

  it("says when a rule is blocking now, and otherwise when it blocks", () => {
    expect(ruleStatus(rule({}), zone, night)).toEqual({ line: "On · Blocking now", tone: "danger" });
    expect(ruleStatus(rule({ mode: "always", windows: [] }), zone, morning)).toEqual({ line: "On · Blocking now", tone: "danger" });
    const later = ruleStatus(rule({}), zone, morning);
    expect(later.tone).toBe("on");
    expect(later.line).toBe(`On · ${ruleWhenLines(rule({}))[0]!.times} · ${ruleWhenLines(rule({}))[0]!.days}`);
  });

  it("says a scheduled rule with no windows has none, and leaves out days a window does not name", () => {
    expect(ruleStatus(rule({ windows: [] }), zone, morning)).toEqual({ line: "On · No windows", tone: "on" });
    const unnamed = rule({ windows: [{ id: "w1", name: "", days: [], start: "21:00", end: "07:00" }] });
    expect(ruleStatus(unnamed, zone, morning).line).toBe(`On · ${ruleWhenLines(unnamed)[0]!.times}`);
  });
});

describe("the way to a rule's page", () => {
  it("edits a rule, and shows quarantine's devices, since quarantine is never edited", () => {
    expect(ruleOpenLabel(rule({}))).toBe("Edit");
    expect(ruleOpenLabel(rule({ builtIn: "quarantine" }))).toBe("Devices");
    expect(ruleHref(rule({ builtIn: "quarantine" }))).toBe("/devices");
  });
});
