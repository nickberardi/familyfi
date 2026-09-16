import { describe, expect, it } from "vitest";
import { dpiAppBlockPolicy, dpiCategoryBlockPolicy } from "@/server/unifi/payloads";
import { D6_CATEGORY_CANDIDATES, D6_MAP_STATUS } from "@/server/unifi/d6-categories";

describe("DPI policy payloads", () => {
  it("builds APPLICATION_CATEGORY destination with MAC source and integer ids", () => {
    const write = dpiCategoryBlockPolicy({
      name: "FamilyFi Fixture Category",
      sourceZoneId: "zone-a",
      destinationZoneId: "zone-ext",
      macAddresses: ["02:00:00:00:00:02", "02:00:00:00:00:01"],
      applicationCategoryIds: [24, 4],
      enabled: true,
    });
    expect(write.source.trafficFilter).toEqual({
      type: "MAC_ADDRESS",
      macAddressFilter: { macAddresses: ["02:00:00:00:00:01", "02:00:00:00:00:02"] },
    });
    expect(write.destination.trafficFilter).toEqual({
      type: "APPLICATION_CATEGORY",
      applicationCategoryFilter: { applicationCategoryIds: [4, 24] },
    });
    expect(write.schedule).toBeUndefined();
  });

  it("builds APPLICATION destination and omits schedule for Always", () => {
    const write = dpiAppBlockPolicy({
      name: "FamilyFi Fixture App",
      sourceZoneId: "zone-a",
      destinationZoneId: "zone-ext",
      macAddresses: ["02:00:00:00:00:01"],
      applicationIds: [10002, 10001],
      enabled: false,
    });
    expect(write.enabled).toBe(false);
    expect(write.destination.trafficFilter).toEqual({
      type: "APPLICATION",
      applicationFilter: { applicationIds: [10001, 10002] },
    });
  });
});

describe("D6 map", () => {
  it("stays provisional until Nick confirms", () => {
    expect(D6_MAP_STATUS).toBe("provisional");
    expect(D6_CATEGORY_CANDIDATES.map((c) => c.slot)).toEqual(["video", "social", "gaming", "porn"]);
  });
});
