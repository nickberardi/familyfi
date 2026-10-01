import { describe, expect, it } from "vitest";
import {
  DEVICE_FILTERS,
  deviceFilterLabel,
  deviceGroupOptions,
  deviceOwner,
  deviceRemoveCopy,
  filterDevices,
  quarantineTitle,
  unassignedBadgeCount,
  unassignedCount,
} from "@/lib/device-list";
import type { Device, Group } from "@/lib/types";

const device = (over: Partial<Device>) =>
  ({ mac: "02:00:00:00:00:01", hostname: null, ip: null, groupId: null, assignment: "quarantined", inScope: true, networkId: null, ...over }) as Device;
const group = (over: Partial<Group>) => ({ id: "g1", name: "A child", kind: "family", ...over }) as Group;

const groups = [group({ id: "g1", name: "A child" }), group({ id: "g2", name: "Cameras", kind: "things" }), group({ id: "g3", name: "An adult" })];
const devices = [
  device({ mac: "02:00:00:00:00:03", hostname: "tablet", groupId: "g1", assignment: "assigned", ip: "10.0.30.7" }),
  device({ mac: "02:00:00:00:00:02", hostname: "camera", groupId: "g2", assignment: "assigned" }),
  device({ mac: "02:00:00:00:00:01" }),
  device({ mac: "02:00:00:00:00:04", hostname: "printer", inScope: false }),
];

describe("the Devices list", () => {
  it("filters by assignment and sorts by name, then MAC", () => {
    expect(filterDevices(devices, groups, "all", "").map((item) => item.mac)).toEqual([
      "02:00:00:00:00:01",
      "02:00:00:00:00:02",
      "02:00:00:00:00:04",
      "02:00:00:00:00:03",
    ]);
    expect(filterDevices(devices, groups, "assigned", "").map((item) => item.hostname)).toEqual(["camera", "tablet"]);
    expect(filterDevices(devices, groups, "loose", "").map((item) => item.mac)).toEqual(["02:00:00:00:00:01", "02:00:00:00:00:04"]);
  });

  it("searches the name, MAC, IP and group, ignoring case and spaces around the query", () => {
    expect(filterDevices(devices, groups, "all", " TAB ").map((item) => item.hostname)).toEqual(["tablet"]);
    expect(filterDevices(devices, groups, "all", "00:02").map((item) => item.hostname)).toEqual(["camera"]);
    expect(filterDevices(devices, groups, "all", "10.0.30").map((item) => item.hostname)).toEqual(["tablet"]);
    expect(filterDevices(devices, groups, "all", "cameras").map((item) => item.hostname)).toEqual(["camera"]);
    expect(filterDevices(devices, groups, "assigned", "unassigned")).toEqual([]);
    expect(filterDevices(devices, groups, "all", "unassigned")).toHaveLength(2);
  });

  it("finds a device's group", () => {
    expect(deviceOwner(devices[0]!, groups)?.name).toBe("A child");
    expect(deviceOwner(devices[2]!, groups)).toBeNull();
  });

  it("counts every Unassigned device in the filter, but only managed ones in the badge", () => {
    expect(unassignedCount(devices)).toBe(2);
    expect(unassignedBadgeCount(devices)).toBe(1);
    const loose = DEVICE_FILTERS.find((item) => item.id === "loose")!;
    expect(deviceFilterLabel(loose, devices)).toBe("Unassigned · 2");
    expect(deviceFilterLabel(loose, [])).toBe("Unassigned");
    expect(deviceFilterLabel(DEVICE_FILTERS[0], devices)).toBe("Everything");
  });

  it("offers Unassigned, then family groups, then things groups", () => {
    expect(deviceGroupOptions(groups)).toEqual([
      { value: "", label: "Unassigned" },
      { value: "g1", label: "A child" },
      { value: "g3", label: "An adult" },
      { value: "g2", label: "Cameras (group)" },
    ]);
  });

  it("names quarantine's state, warning when it is off", () => {
    expect(quarantineTitle(true)).toBe("Quarantine unassigned devices");
    expect(quarantineTitle(false)).toMatch(/^Quarantine is off/);
  });

  it("names a device's removal by its name and MAC", () => {
    expect(deviceRemoveCopy(device({ hostname: "tablet", mac: "02:00:00:00:00:0a" })).label).toBe("Delete tablet (02:00:00:00:00:0A)");
    expect(deviceRemoveCopy(device({})).title).toBe("Remove Unnamed device?");
  });
});
