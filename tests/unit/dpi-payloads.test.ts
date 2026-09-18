import { describe, expect, it } from "vitest";
import { dpiAppBlockPolicy, dpiAppNetworkBlockPolicy, dpiCategoryBlockPolicy, dpiCategoryNetworkBlockPolicy } from "@/server/unifi/payloads";
import { CURATED_CATEGORY_CANDIDATES, CURATED_MAP_STATUS } from "@/server/unifi/curated-categories";
import { CURATED_CATEGORY_SLOTS } from "@/lib/rules";
import { UPSTREAM_SEED_CATEGORIES } from "@/lib/upstream-domains";

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

describe("curated map", () => {
  it("locks the curated ids (no Porn slot)", () => {
    expect(CURATED_MAP_STATUS).toBe("confirmed");
    expect(CURATED_CATEGORY_CANDIDATES.map((c) => c.slot)).toEqual([
      "video",
      "social",
      "gaming",
      "vpn",
      "messaging",
    ]);
    expect(CURATED_CATEGORY_CANDIDATES.map((c) => c.categoryId)).toEqual([4, 24, 8, 11, 0]);
    expect(CURATED_CATEGORY_CANDIDATES.some((c) => (c as { slot: string }).slot === "porn")).toBe(false);
  });

  /** The server table and the client mirror are two files; they must not drift. */
  it("matches the client-side mirror exactly", () => {
    expect(CURATED_CATEGORY_SLOTS).toEqual(CURATED_CATEGORY_CANDIDATES);
  });

  /** Every curated slot needs a domain list behind it, or its mark can never go purple. */
  it("has an upstream seed category for every curated slot", () => {
    const seeded = new Set(UPSTREAM_SEED_CATEGORIES.map((category) => category.slug));
    for (const candidate of CURATED_CATEGORY_CANDIDATES) {
      expect(seeded.has(candidate.slot), candidate.slot).toBe(true);
    }
  });
});

describe("NETWORK-source DPI payloads", () => {
  it("builds APPLICATION_CATEGORY with NETWORK source and matchOpposite false", async () => {
    const write = dpiCategoryNetworkBlockPolicy({
      name: "FamilyFi Fixture Net Category",
      sourceZoneId: "zone-a",
      destinationZoneId: "zone-ext",
      networkIds: ["22222222-2222-4222-8222-222222222223", "22222222-2222-4222-8222-222222222222"],
      applicationCategoryIds: [4],
      enabled: true,
    });
    expect(write.source.trafficFilter).toEqual({
      type: "NETWORK",
      networkFilter: {
        matchOpposite: false,
        networkIds: ["22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-222222222223"],
      },
    });
    expect(write.destination.trafficFilter).toEqual({
      type: "APPLICATION_CATEGORY",
      applicationCategoryFilter: { applicationCategoryIds: [4] },
    });
  });

  it("builds APPLICATION with NETWORK source", async () => {
    const write = dpiAppNetworkBlockPolicy({
      name: "FamilyFi Fixture Net App",
      sourceZoneId: "zone-a",
      destinationZoneId: "zone-ext",
      networkIds: ["22222222-2222-4222-8222-222222222222"],
      applicationIds: [10001],
      enabled: false,
    });
    expect(write.enabled).toBe(false);
    expect(write.source.trafficFilter?.type).toBe("NETWORK");
    expect(write.destination.trafficFilter).toEqual({
      type: "APPLICATION",
      applicationFilter: { applicationIds: [10001] },
    });
  });
});
