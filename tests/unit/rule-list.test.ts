import { describe, expect, it } from "vitest";
import { runRuleAction, toggleRuleEnabled } from "@/lib/group-writes";
import type { HouseholdStore, MutateOptions } from "@/lib/household-store";
import {
  noRulesFor,
  ruleAppliesTo,
  ruleBarBands,
  ruleCardDimmed,
  ruleHref,
  ruleMarkSpec,
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
});
