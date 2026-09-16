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
          scope: "group" as const,
          groupId: "g1",
          networkIds: [],
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
          scope: "group" as const,
          groupId: "g2",
          networkIds: [],
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

  it("plans NETWORK source buckets for managed network-scoped rules", () => {
    const { policies, orphanRuleIds } = planDpiPolicies({
      now: new Date("2026-09-15T12:00:00Z"),
      destinationZoneId: "ext",
      zoneNames: { "zone-1": "Internal", "zone-2": "IoT" },
      groups: [],
      devices: [],
      networks: [
        { id: "net-a", name: "Family", zoneId: "zone-1" },
        { id: "net-b", name: "IoT", zoneId: "zone-2" },
      ],
      networkScope: { manageAllNetworks: false, managedNetworkIds: ["net-a"] },
      rules: [
        {
          id: "rn1",
          kind: FamRuleKind.category,
          scope: "network" as const,
          groupId: null,
          networkIds: ["net-a", "net-unmanaged"],
          targetIds: [24],
          enabled: true,
          mode: FamRuleMode.always,
          scheduleEnabled: false,
          scheduleDays: [],
          scheduleStart: null,
          scheduleEnd: null,
        },
        {
          id: "rn-orphan",
          kind: FamRuleKind.app,
          scope: "network" as const,
          groupId: null,
          networkIds: ["net-unmanaged"],
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
    expect(policies[0]?.sourceType).toBe("NETWORK");
    expect(policies[0]?.networkIds).toEqual(["net-a"]);
    expect(policies[0]?.macAddresses).toEqual([]);
    expect(orphanRuleIds.has("rn-orphan")).toBe(true);
  });
});
