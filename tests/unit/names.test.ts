import { GroupKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { pausePolicyName, quarantinePolicyName, spikePolicyName } from "@/server/unifi/names";
import { MAX_POLICY_NAME, rulePolicyNames } from "@/lib/policy-names";

const rule = (patch: Partial<Parameters<typeof rulePolicyNames>[0]> = {}) => ({
  id: "cmrule0000abcd",
  name: "School nights",
  useGeneratedName: false,
  mode: "scheduled" as const,
  windows: [{ name: "" }],
  ...patch,
});

describe("UniFi policy names", () => {
  it("uses descriptive FamilyFi titles", () => {
    expect(quarantinePolicyName("Internal")).toBe("FamilyFi Quarantine Internal Devices");
    expect(pausePolicyName({ name: "Betsy", kind: GroupKind.family, zoneName: "Internal" })).toBe(
      "FamilyFi Betsy's Internet Pause",
    );
    expect(pausePolicyName({ name: "Betsy", kind: GroupKind.family, zoneName: "IoT" })).toBe(
      "FamilyFi Betsy's Internet Pause (IoT)",
    );
    expect(pausePolicyName({ name: "TV", kind: GroupKind.things, zoneName: "Internal" })).toBe(
      "FamilyFi TV Internet Pause",
    );
    expect(spikePolicyName("Internal")).toBe("FamilyFi Spike Internal Devices");
  });
});

describe("rule policy names", () => {
  it("follows the rule name, one policy per window", () => {
    expect(rulePolicyNames(rule())).toEqual(["FamilyFi School nights"]);
    expect(rulePolicyNames(rule({ mode: "always", windows: [] }))).toEqual(["FamilyFi School nights"]);
  });

  it("adds the window name from the second window on", () => {
    const windows = [{ name: "Dinner" }, { name: " " }];
    expect(rulePolicyNames(rule({ name: "TV downtime", windows }))).toEqual([
      "FamilyFi TV downtime – Dinner",
      "FamilyFi TV downtime – Window 2",
    ]);
  });

  it("names a zone other than Internal", () => {
    expect(rulePolicyNames(rule(), "IoT")).toEqual(["FamilyFi School nights (IoT)"]);
  });

  it("uses a generated name on request and keeps the prefix", () => {
    expect(rulePolicyNames(rule({ useGeneratedName: true }))).toEqual(["FamilyFi Rule ABCD"]);
    expect(rulePolicyNames(rule({ name: "  " }))).toEqual(["FamilyFi Untitled rule"]);
  });

  it("clips to UniFi's limit", () => {
    const [name] = rulePolicyNames(rule({ name: "x".repeat(60), windows: [{ name: "y".repeat(30) }, { name: "z" }] }), "Guest network zone");
    expect(name!.length).toBe(MAX_POLICY_NAME);
    expect(name!.endsWith("…")).toBe(true);
  });
});
