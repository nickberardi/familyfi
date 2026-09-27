import { describe, expect, it } from "vitest";
import { effectivePresence, presenceLabel, presenceSummary } from "@/lib/device-presence";
import type { Device } from "@/lib/types";

const NOW = new Date("2026-09-27T20:00:00.000Z");

function device(overrides: Partial<Device> = {}): Device {
  return {
    mac: "02:00:00:00:00:01",
    manufacturer: null,
    hostname: "TV",
    ip: "192.0.2.20",
    networkId: "network",
    zoneId: "zone",
    groupId: "group",
    assignment: "assigned",
    lastSeenAt: "2026-09-27T19:55:00.000Z",
    presence: "online",
    presenceCheckedAt: "2026-09-27T19:59:00.000Z",
    connectedAt: "2026-09-27T19:42:00.000Z",
    connectionType: "wireless",
    accessPointName: "Upstairs AP",
    unresolved: false,
    inScope: true,
    ...overrides,
  };
}

describe("device presence display", () => {
  it("keeps a fresh observation and names its access point and connection start", () => {
    const current = device();
    expect(effectivePresence(current, NOW)).toBe("online");
    expect(presenceSummary(current, "America/New_York", NOW)).toContain("Online · Upstairs AP · since");
  });

  it("ages online and offline observations after 90 seconds without a new API response", () => {
    const old = "2026-09-27T19:58:29.000Z";
    expect(effectivePresence(device({ presenceCheckedAt: old }), NOW)).toBe("stale_online");
    expect(effectivePresence(device({ presence: "offline", presenceCheckedAt: old }), NOW)).toBe("stale_offline");
    expect(presenceSummary(device({ presenceCheckedAt: old }), "UTC", NOW)).toContain("Last known online");
    expect(presenceLabel("stale_offline")).toBe("Last known offline");
  });

  it("shows offline last seen and never treats an absent or invalid observation as online", () => {
    const offline = device({ presence: "offline", connectedAt: null, presenceCheckedAt: NOW.toISOString() });
    expect(presenceSummary(offline, "UTC", NOW)).toContain("Offline · last seen");
    expect(effectivePresence(device({ presence: "unknown", presenceCheckedAt: null }), NOW)).toBe("unknown");
    expect(effectivePresence(device({ presenceCheckedAt: "invalid" }), NOW)).toBe("unknown");
  });
});
