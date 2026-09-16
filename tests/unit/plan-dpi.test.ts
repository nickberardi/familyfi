import { AssignmentState, FamRuleKind, FamRuleMode, GroupKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { planDpiPolicies } from "@/server/unifi/plan-dpi";

describe("planDpiPolicies", () => {
  it("skips protected groups and plans MAC+zone buckets for mutable groups", () => {
    const { policies } = planDpiPolicies({
      now: new Date("2026-09-15T12:00:00Z"),
      destinationZoneId: "ext",
      zoneNames: { "zone-1": "Internal" },
      groups: [
        { id: "g1", name: "Betsy", kind: GroupKind.family, protected: false },
        { id: "g2", name: "Nick", kind: GroupKind.family, protected: true },
      ],
      devices: [
        {
          mac: "02:00:00:00:00:01",
          assignment: AssignmentState.assigned,
          groupId: "g1",
          zoneId: "zone-1",
          inScope: true,
        },
        {
          mac: "02:00:00:00:00:99",
          assignment: AssignmentState.assigned,
          groupId: "g2",
          zoneId: "zone-1",
          inScope: true,
        },
      ],
      rules: [
        {
          id: "r1",
          kind: FamRuleKind.category,
          groupId: "g1",
          targetIds: [4],
          enabled: true,
          mode: FamRuleMode.always,
          scheduleEnabled: false,
          scheduleDays: [],
          scheduleStart: null,
          scheduleEnd: null,
        },
        {
          id: "r2",
          kind: FamRuleKind.app,
          groupId: "g2",
          targetIds: [10001],
          enabled: true,
          mode: FamRuleMode.always,
          scheduleEnabled: false,
          scheduleDays: [],
          scheduleStart: null,
          scheduleEnd: null,
        },
      ],
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.famRuleId).toBe("r1");
    expect(policies[0]?.macAddresses).toEqual(["02:00:00:00:00:01"]);
    expect(policies[0]?.schedule).toBeUndefined();
  });
});
