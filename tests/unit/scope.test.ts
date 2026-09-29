import { AssignmentState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { networkInScope, resolveNetworkScope } from "@/server/unifi/scope";
import { planPolicies } from "@/server/unifi/plan";

describe("network scope", () => {
  it("treats unknown VLAN as out of scope", () => {
    expect(networkInScope({ manageAllNetworks: true, managedNetworkIds: [] }, null)).toBe(false);
    expect(networkInScope({ manageAllNetworks: true, managedNetworkIds: [] }, "net-kids")).toBe(true);
    expect(networkInScope({ manageAllNetworks: false, managedNetworkIds: ["net-kids"] }, "net-iot")).toBe(false);
    expect(networkInScope({ manageAllNetworks: false, managedNetworkIds: ["net-kids"] }, "net-kids")).toBe(true);
    expect(networkInScope({ manageAllNetworks: false, managedNetworkIds: [] }, "net-kids")).toBe(false);
  });

  it("clears allowlist when managing all networks", () => {
    expect(
      resolveNetworkScope({
        manageAllNetworks: true,
        managedNetworkIds: ["stale"],
        previous: { manageAllNetworks: false, managedNetworkIds: ["stale"] },
      }),
    ).toEqual({ manageAllNetworks: true, managedNetworkIds: [] });
  });
});

describe("planPolicies network scope", () => {
  it("does not quarantine MACs that are out of VLAN scope", () => {
    const planned = planPolicies({
      installId: "default",
      destinationZoneId: "ext",
      groups: [],
      devices: [
        {
          mac: "aa:aa:aa:aa:aa:01",
          assignment: AssignmentState.quarantined,
          groupId: null,
          zoneId: "z1",
          inScope: true,
        },
        {
          mac: "aa:aa:aa:aa:aa:99",
          assignment: AssignmentState.quarantined,
          groupId: null,
          zoneId: "z1",
          inScope: false,
        },
      ],
    });
    expect(planned.policies).toHaveLength(1);
    expect(planned.policies[0]?.macAddresses).toEqual(["aa:aa:aa:aa:aa:01"]);
    expect(planned.retainOwners.size).toBe(0);
  });

  it("plans no policy of its own for an assigned MAC, in or out of scope", () => {
    const planned = planPolicies({
      installId: "default",
      destinationZoneId: "ext",
      groups: [{ id: "kid" }],
      devices: [
        { mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z-iot", inScope: false },
        { mac: "aa:aa:aa:aa:aa:02", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z1", inScope: true },
      ],
    });
    expect(planned.policies).toEqual([]);
    expect(planned.retainOwners.size).toBe(0);
  });
});
