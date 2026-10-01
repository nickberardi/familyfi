/**
 * The Devices list every client shows: its filters, what a search matches, the groups a device can
 * be put in, and the list's copy.
 */
import { byDeviceName } from "./device-assign";
import type { Device, Group } from "./types";

export const DEVICE_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "assigned", label: "Assigned" },
  { id: "loose", label: "Unassigned" },
] as const;

export type DeviceFilterId = (typeof DEVICE_FILTERS)[number]["id"];

/** The group a device is assigned to, or null when it is Unassigned. */
export function deviceOwner(device: Pick<Device, "groupId">, groups: Group[]): Group | null {
  return groups.find((group) => group.id === device.groupId) ?? null;
}

/** The devices a filter and a search show, by name: a search matches the name, MAC, IP or group. */
export function filterDevices(devices: Device[], groups: Group[], filter: DeviceFilterId, query: string): Device[] {
  const q = query.trim().toLowerCase();
  return devices
    .filter((device) => {
      if (filter === "assigned") return device.assignment === "assigned";
      if (filter === "loose") return device.assignment === "quarantined";
      return true;
    })
    .filter((device) => {
      if (!q) return true;
      const owner = deviceOwner(device, groups);
      const hay = [device.hostname ?? "", device.mac, device.ip ?? "", owner?.name ?? "unassigned"].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort(byDeviceName);
}

/** The Unassigned filter's count: every quarantined device. */
export function unassignedCount(devices: Pick<Device, "assignment">[]): number {
  return devices.filter((device) => device.assignment === "quarantined").length;
}

/** The Devices navigation badge: quarantined devices on a managed network, the ones FamilyFi holds back. */
export function unassignedBadgeCount(devices: Pick<Device, "assignment" | "inScope">[]): number {
  return devices.filter((device) => device.assignment === "quarantined" && device.inScope).length;
}

/** The filter's label, with the Unassigned count when there are any. */
export function deviceFilterLabel(filter: (typeof DEVICE_FILTERS)[number], devices: Pick<Device, "assignment">[]): string {
  const count = filter.id === "loose" ? unassignedCount(devices) : 0;
  return count ? `${filter.label} · ${count}` : filter.label;
}

/** Where a device can go: Unassigned, then each family group, then each things group marked "(group)". */
export function deviceGroupOptions(groups: Pick<Group, "id" | "name" | "kind">[]): { value: string; label: string }[] {
  return [
    { value: "", label: "Unassigned" },
    ...groups.filter((group) => group.kind === "family").map((group) => ({ value: group.id, label: group.name })),
    ...groups.filter((group) => group.kind === "things").map((group) => ({ value: group.id, label: `${group.name} (group)` })),
  ];
}

/** The quarantine switch's title: the state quarantine is in, warning when it is off. */
export function quarantineTitle(enforced: boolean): string {
  return enforced ? "Quarantine unassigned devices" : "Quarantine is off — unassigned devices may have internet";
}

export const DEVICES_COPY = {
  title: "Devices",
  subtitle: "Assignment is by MAC address and persists while a device is offline.",
  detailSubtitle: "Assignment persists while a device is offline.",
  noDevices: "No devices yet. New in-scope MACs appear as unassigned.",
  noMatch: "Nothing matches this filter.",
  search: "Search name, IP or MAC",
  quarantineLabel: "Quarantine unassigned devices",
  quarantineBody: "New arrivals stay off the internet until assigned. Off is an emergency override on FamilyFi policies only.",
  quarantineOn: "Enforced",
  quarantineOff: "Off",
  loading: "Loading devices…",
} as const;

/** What a device's group control is called: its group "for" the device. */
export function deviceGroupLabel(device: Pick<Device, "hostname" | "mac">): string {
  return `Group for ${device.hostname ?? device.mac}`;
}

/** What removing a device is called, and the native app's confirmation of it. */
export function deviceRemoveCopy(device: Pick<Device, "hostname" | "mac">) {
  const name = device.hostname ?? "Unnamed device";
  return {
    label: `Delete ${name} (${device.mac.toUpperCase()})`,
    action: "Remove",
    title: `Remove ${name}?`,
    message: "FamilyFi forgets this device. If it joins a managed network again, it comes back as unassigned.",
    confirm: "Remove device",
  } as const;
}
