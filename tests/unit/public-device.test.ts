import { AssignmentState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { publicDevice } from "@/server/devices";

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
    manufacturer: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
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

  it("reads an offline device as checked by the household's last sweep, which does not rewrite it", () => {
    const old = new Date(NOW.getTime() - 60 * 60_000);
    const swept = new Date(NOW.getTime() - 10_000);
    const offline = publicDevice(row({ presenceOnline: false, presenceCheckedAt: old }), undefined, NOW, swept);
    expect(offline.presence).toBe("offline");
    expect(offline.presenceCheckedAt).toBe(swept.toISOString());
    // A sweep older than the device's own check, or from before the device existed, says nothing new.
    expect(publicDevice(row({ presenceOnline: false, presenceCheckedAt: swept }), undefined, NOW, old).presenceCheckedAt).toBe(swept.toISOString());
    const added = publicDevice(row({ presenceOnline: false, presenceCheckedAt: old, createdAt: NOW }), undefined, NOW, swept);
    expect(added.presence).toBe("stale_offline");
    // The sweep skips only devices already offline: an online one read before a later pass keeps its own check.
    expect(publicDevice(row({ presenceOnline: true, presenceCheckedAt: old }), undefined, NOW, swept).presence).toBe("stale_online");
    // Never checked stays unknown.
    expect(publicDevice(row(), undefined, NOW, swept).presence).toBe("unknown");
  });

  it("returns the manufacturer recorded at sync without consulting the registry", () => {
    expect(publicDevice(row(), undefined, NOW).manufacturer).toBeNull();
    expect(publicDevice(row({ manufacturer: "Example Registrant" }), undefined, NOW).manufacturer).toBe("Example Registrant");
  });

});
