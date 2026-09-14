import { describe, expect, it } from "vitest";
import { quarantineBlockingFromLive } from "@/server/quarantine";

describe("quarantineBlockingFromLive", () => {
  it("is on if any FamilyFi quarantine policy is enabled", () => {
    expect(quarantineBlockingFromLive([{ enabled: false }, { enabled: true }])).toBe(true);
  });

  it("is off when every observed policy is disabled", () => {
    expect(quarantineBlockingFromLive([{ enabled: false }, { enabled: false }])).toBe(false);
  });

  it("is off when there are no policies", () => {
    expect(quarantineBlockingFromLive([])).toBe(false);
  });
});
