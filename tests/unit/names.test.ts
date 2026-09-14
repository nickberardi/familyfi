import { GroupKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { groupPolicyName, quarantinePolicyName, spikePolicyName } from "@/server/unifi/names";

describe("UniFi policy names", () => {
  it("uses descriptive FamilyFi titles", () => {
    expect(quarantinePolicyName("Internal")).toBe("FamilyFi Quarantine Internal Devices");
    expect(groupPolicyName({ name: "Betsy", kind: GroupKind.family, zoneName: "Internal" })).toBe(
      "FamilyFi Betsy's Internet Access",
    );
    expect(groupPolicyName({ name: "Betsy", kind: GroupKind.family, zoneName: "IoT" })).toBe(
      "FamilyFi Betsy's Internet Access (IoT)",
    );
    expect(groupPolicyName({ name: "TV", kind: GroupKind.things, zoneName: "Internal" })).toBe(
      "FamilyFi TV Internet Access",
    );
    expect(spikePolicyName("Internal")).toBe("FamilyFi Spike Internal Devices");
  });
});
