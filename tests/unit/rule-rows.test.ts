import { describe, expect, it } from "vitest";
import { buildRuleRows } from "@/lib/rule-rows";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

function group(partial: Partial<Group> & Pick<Group, "id" | "name">): Group {
  return {
    kind: "family",
    monogram: null,
    familyRole: "child",
    protected: false,
    mode: "scheduled",
    deviceCount: 2,
    schedule: { enabled: true, days: [1, 2, 3], start: "21:00", end: "07:00" },
    suspension: { active: false, until: null },
    access: "available",
    ...partial,
  };
}

function rule(partial: Partial<Rule> & Pick<Rule, "id" | "kind" | "targetIds">): Rule {
  return {
    scope: "group",
    groupId: "g1",
    networkIds: [],
    enabled: true,
    mode: "always",
    schedule: { enabled: false, days: [], start: null, end: null },
    internet: false,
    ...partial,
  };
}

const labels = new Map([["app:99", "TikTok"]]);
const networkNames = new Map([
  ["n1", "Kids"],
  ["n2", "Guest"],
]);

describe("buildRuleRows", () => {
  it("nests a group's filters directly under its Internet row", () => {
    const rows = buildRuleRows({
      groups: [group({ id: "g1", name: "Betsy" }), group({ id: "g2", name: "Abby" })],
      rules: [
        rule({ id: "r1", kind: "category", targetIds: [4] }),
        rule({ id: "r2", kind: "app", targetIds: [99] }),
        rule({ id: "r3", kind: "category", targetIds: [24], groupId: "g2" }),
      ],
      labels,
      networkNames,
    });

    expect(rows.map((r) => r.name)).toEqual(["Betsy", "Video", "TikTok", "Abby", "Social"]);
    expect(rows.map((r) => r.nested)).toEqual([false, true, true, false, true]);
  });

  it("omits protected groups entirely", () => {
    const rows = buildRuleRows({
      groups: [group({ id: "g1", name: "Betsy" }), group({ id: "g9", name: "Smart home", protected: true })],
      rules: [],
      labels,
      networkNames,
    });
    expect(rows.map((r) => r.name)).toEqual(["Betsy"]);
  });

  it("makes Internet rows undeletable and filter rows deletable", () => {
    const rows = buildRuleRows({
      groups: [group({ id: "g1", name: "Betsy" })],
      rules: [rule({ id: "r1", kind: "category", targetIds: [4] })],
      labels,
      networkNames,
    });
    expect(rows[0]).toMatchObject({ kind: "internet", canDelete: false });
    expect(rows[1]).toMatchObject({ kind: "filter", canDelete: true });
  });

  it("sorts network rules ahead of members and names their VLANs", () => {
    const rows = buildRuleRows({
      groups: [group({ id: "g1", name: "Betsy" })],
      rules: [
        rule({ id: "n", kind: "category", targetIds: [8], scope: "network", groupId: null, networkIds: ["n1", "n2"] }),
      ],
      labels,
      networkNames,
    });
    expect(rows[0]).toMatchObject({
      kind: "network",
      name: "Gaming",
      kindTag: "Kids, Guest networks",
      canDelete: true,
    });
    expect(rows[0].mark).toMatchObject({ kind: "network", label: "NET" });
    expect(rows[1].kind).toBe("internet");
  });

  it("singularises a one-network rule tag", () => {
    const rows = buildRuleRows({
      groups: [],
      rules: [
        rule({ id: "n", kind: "category", targetIds: [8], scope: "network", groupId: null, networkIds: ["n1"] }),
      ],
      labels,
      networkNames,
    });
    expect(rows[0].kindTag).toBe("Kids network");
  });

  it("tags people by role and Things groups by device count", () => {
    const rows = buildRuleRows({
      groups: [
        group({ id: "g1", name: "Abby", familyRole: "teen" }),
        group({ id: "g2", name: "TVs", kind: "things", monogram: "TV", deviceCount: 3 }),
      ],
      rules: [],
      labels,
      networkNames,
    });
    expect(rows[0].kindTag).toBe("Internet · teen");
    expect(rows[0].mark).toMatchObject({ kind: "person", label: "A" });
    expect(rows[1].kindTag).toBe("Internet · group · 3");
    expect(rows[1].mark).toMatchObject({ kind: "group", label: "TV" });
  });

  it("reads Internet On/Off from suspension, not the schedule flag (D2)", () => {
    const rows = buildRuleRows({
      groups: [
        group({ id: "g1", name: "On", suspension: { active: false, until: null } }),
        group({ id: "g2", name: "Paused", suspension: { active: true, until: null } }),
      ],
      rules: [],
      labels,
      networkNames,
    });
    expect(rows[0].enabled).toBe(true);
    expect(rows[1].enabled).toBe(false);
  });

  it("maps a group in always mode to the Always segment", () => {
    const rows = buildRuleRows({
      groups: [
        group({
          id: "g1",
          name: "Always",
          mode: "always",
          schedule: { enabled: false, days: [], start: null, end: null },
        }),
      ],
      rules: [],
      labels,
      networkNames,
    });
    expect(rows[0].mode).toBe("always");
  });

  it("gives curated categories a glyph slot and apps a monogram", () => {
    const rows = buildRuleRows({
      groups: [group({ id: "g1", name: "Betsy" })],
      rules: [
        rule({ id: "r1", kind: "category", targetIds: [4] }),
        rule({ id: "r2", kind: "app", targetIds: [99] }),
      ],
      labels,
      networkNames,
    });
    expect(rows[1].mark).toMatchObject({ slot: "video", label: "" });
    expect(rows[2].mark).toMatchObject({ slot: undefined, label: "TI" });
  });
});
