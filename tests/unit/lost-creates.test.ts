import { describe, expect, it } from "vitest";
import { carriesWrite, reclaims } from "@/server/unifi/lost-creates";
import { internetBlockPolicy } from "@/server/unifi/payloads";
import type { FirewallPolicy } from "@/server/unifi/types";

const write = internetBlockPolicy({
  name: "FamilyFi Bedtime",
  sourceZoneId: "zone-internal",
  destinationZoneId: "zone-external",
  macAddresses: ["02:00:00:00:00:01", "02:00:00:00:00:02"],
});

/** Reverses every object's keys, as a console free to order its JSON its own way might. */
function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)]));
  }
  return value;
}

describe("carriesWrite", () => {
  it("matches the policy a write made whatever order the gateway lists it in, and its defaults", () => {
    const listed = reordered({ ...write, id: "p1", index: 7, metadata: { origin: "USER_DEFINED" }, connectionStateType: "ALL" }) as typeof write;
    listed.source.trafficFilter?.macAddressFilter?.macAddresses.reverse();
    expect(carriesWrite(listed, JSON.parse(JSON.stringify(write)))).toBe(true);
  });

  it("does not match a policy that differs in any field the write set", () => {
    expect(carriesWrite({ ...write, name: "Kids bedtime" }, write)).toBe(false);
    expect(carriesWrite({ ...write, enabled: !write.enabled }, write)).toBe(false);
    const fewer = { ...write, source: { ...write.source, trafficFilter: undefined } };
    expect(carriesWrite(fewer, write)).toBe(false);
    const oneMac = internetBlockPolicy({
      name: write.name,
      sourceZoneId: "zone-internal",
      destinationZoneId: "zone-external",
      macAddresses: ["02:00:00:00:00:01"],
    });
    expect(carriesWrite(oneMac, write)).toBe(false);
  });
});

describe("reclaims", () => {
  const schedule = { mode: "EVERY_DAY", timeFilter: { from: "21:00", to: "07:00" } } as unknown as NonNullable<typeof write.schedule>;
  const listed = (extra: Partial<FirewallPolicy> = {}) => ({ ...write, id: "p1", ...extra }) as FirewallPolicy;

  it("takes a lost create's policy that carries the whole write", () => {
    expect(reclaims(listed(), write)).toBe(true);
    expect(reclaims(listed({ schedule }), { ...write, schedule })).toBe(true);
  });

  it("never takes a window's policy for an always-on write, whose write leaves the schedule out", () => {
    expect(carriesWrite({ ...write, schedule, id: "p1" }, write)).toBe(true);
    expect(reclaims(listed({ schedule }), write)).toBe(false);
  });
});
