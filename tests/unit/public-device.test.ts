import { AssignmentState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { publicDevice } from "@/server/devices";
import { macRegistrant } from "@/server/mac-vendor";

const NOW = new Date("2026-09-27T20:00:00.000Z");

function row(overrides: Partial<Parameters<typeof publicDevice>[0]> = {}): Parameters<typeof publicDevice>[0] {
  return {
    mac: "02:00:00:00:00:01",
    hostname: "TV",
    ip: "192.0.2.20",
    networkId: "network",
    zoneId: "zone",
    groupId: null,
    assignment: AssignmentState.quarantined,
    lastSeenAt: NOW,
    presenceOnline: null,
    presenceCheckedAt: null,
    connectedAt: null,
    connectionType: null,
    accessPointName: null,
    ...overrides,
  };
}

describe("public device observation", () => {
  it("distinguishes never checked, fresh, and stale results", () => {
    expect(publicDevice(row(), undefined, NOW).presence).toBe("unknown");
    const recent = new Date(NOW.getTime() - 90_000);
    expect(publicDevice(row({ presenceOnline: true, presenceCheckedAt: recent }), undefined, NOW).presence).toBe("online");
    expect(publicDevice(row({ presenceOnline: false, presenceCheckedAt: recent }), undefined, NOW).presence).toBe("offline");
    const old = new Date(NOW.getTime() - 90_001);
    expect(publicDevice(row({ presenceOnline: true, presenceCheckedAt: old }), undefined, NOW).presence).toBe("stale_online");
    expect(publicDevice(row({ presenceOnline: false, presenceCheckedAt: old }), undefined, NOW).presence).toBe("stale_offline");
  });

  it("does not infer a manufacturer from a private or malformed MAC", () => {
    expect(macRegistrant("02:00:00:00:00:01")).toBeNull();
    expect(macRegistrant("invalid")).toBeNull();
    expect(publicDevice(row(), undefined, NOW).manufacturer).toBeNull();
  });

});
