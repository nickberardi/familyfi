import { describe, expect, it } from "vitest";
import { assignDevicesCopy, byDeviceName, deviceName, networkLabel } from "@/lib/device-assign";
import type { Device } from "@/lib/types";

const device = (over: Partial<Device>) => ({ mac: "02:00:00:00:00:01", hostname: null, assignment: "quarantined", inScope: true, networkId: null, ...over }) as Device;

describe("device assignment", () => {
  it("sorts devices by name, then MAC", () => {
    const list = [
      device({ mac: "02:00:00:00:00:03", hostname: "tablet" }),
      device({ mac: "02:00:00:00:00:01" }),
      device({ mac: "02:00:00:00:00:04", hostname: "laptop" }),
    ].sort(byDeviceName);
    expect(list.map((item) => item.mac)).toEqual(["02:00:00:00:00:01", "02:00:00:00:00:04", "02:00:00:00:00:03"]);
    expect(deviceName(list[0]!)).toBe("Unnamed device");
  });

  it("names a device's network", () => {
    const networks = [{ id: "n1", name: "Kids", vlanId: 30 }];
    expect(networkLabel(device({ networkId: "n1" }), networks)).toBe("Kids (VLAN 30)");
    expect(networkLabel(device({ inScope: false }), networks)).toBe("Out of managed VLANs");
    expect(networkLabel(device({}), networks)).toBe("Unknown network");
  });

  it("tells a group with no devices why it needs one", () => {
    expect(assignDevicesCopy({ name: "A child" })).toMatchObject({
      needsTitle: "A child needs devices",
      needsBody: "A child has no assigned devices, so its UniFi policies cannot be created. Assign an unassigned device below.",
    });
  });
});
