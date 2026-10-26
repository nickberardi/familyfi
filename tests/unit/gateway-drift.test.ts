import { describe, expect, it } from "vitest";
import { gatewayDrift } from "@/server/unifi/drift";
import { internetBlockPolicy } from "@/server/unifi/payloads";
import type { FirewallPolicy, UnifiFirewallSchedule } from "@/server/unifi/types";

const schedule = { mode: "EVERY_DAY", timeFilter: { startTime: "21:00", endTime: "07:00" } } as unknown as UnifiFirewallSchedule;
const write = internetBlockPolicy({ name: "FamilyFi Bedtime", sourceZoneId: "lan", destinationZoneId: "wan", macAddresses: ["02:00:00:00:00:01", "02:00:00:00:00:02"], schedule });
const onGateway = (over: Partial<FirewallPolicy> = {}): FirewallPolicy => ({ ...structuredClone(write), id: "p1", index: 1, metadata: { origin: "USER_DEFINED" }, ...over });

describe("gateway drift", () => {
  it("finds nothing when the gateway still carries the write, whatever it adds or reorders", () => {
    const policy = onGateway({ connectionStateFilter: ["NEW"] });
    policy.source.trafficFilter!.macAddressFilter!.macAddresses = ["02:00:00:00:00:02", "02:00:00:00:00:01"];
    expect(gatewayDrift(policy, write)).toEqual([]);
  });

  it("says what was changed, field by field", () => {
    const policy = onGateway({ enabled: false, name: "Bed" });
    policy.source.trafficFilter!.macAddressFilter!.macAddresses = ["02:00:00:00:00:01"];
    expect(gatewayDrift(policy, write)).toEqual([
      { field: "switch", familyfi: true, gateway: false },
      { field: "devices", familyfi: ["02:00:00:00:00:01", "02:00:00:00:00:02"], gateway: ["02:00:00:00:00:01"] },
      { field: "name", familyfi: "FamilyFi Bedtime", gateway: "Bed" },
    ]);
  });

  it("tells a removed schedule from a different one", () => {
    expect(gatewayDrift(onGateway({ schedule: null }), write)).toEqual([{ field: "schedule", familyfi: "scheduled", gateway: "always" }]);
    const other = { ...schedule, timeFilter: { startTime: "22:00", endTime: "07:00" } } as unknown as UnifiFirewallSchedule;
    expect(gatewayDrift(onGateway({ schedule: other }), write)).toEqual([{ field: "schedule", familyfi: "scheduled", gateway: "different" }]);
    const always = internetBlockPolicy({ name: "FamilyFi Bedtime", sourceZoneId: "lan", destinationZoneId: "wan", macAddresses: ["02:00:00:00:00:01"] });
    expect(gatewayDrift({ ...onGateway(), ...structuredClone(always), schedule }, always)).toEqual([{ field: "schedule", familyfi: "always", gateway: "scheduled" }]);
  });

  it("counts anything else the write sets as other", () => {
    expect(gatewayDrift(onGateway({ action: { type: "ALLOW" } as FirewallPolicy["action"] }), write)).toEqual([{ field: "other" }]);
    expect(gatewayDrift(onGateway({ destination: { zoneId: "elsewhere" } }), write)).toEqual([{ field: "other" }]);
  });
});
