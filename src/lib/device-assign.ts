/**
 * Putting devices in a group, as every client offers it: the devices waiting for one, how a
 * device is named and placed, and what a group with none is told.
 */
import type { Device, Group } from "./types";

/** A device's name in a list: its hostname, or "Unnamed device". */
export function deviceName(device: Pick<Device, "hostname">): string {
  return device.hostname ?? "Unnamed device";
}

/** Devices by name, then MAC, as every device list sorts them. */
export function byDeviceName(a: Pick<Device, "hostname" | "mac">, b: Pick<Device, "hostname" | "mac">): number {
  return (a.hostname ?? a.mac).localeCompare(b.hostname ?? b.mac);
}

/** The network a device is on, by name and VLAN. */
export function networkLabel(device: Device, networks: { id: string; name: string; vlanId: number }[]) {
  const match = networks.find((network) => network.id === device.networkId);
  if (match) return `${match.name} (VLAN ${match.vlanId})`;
  if (!device.inScope) return "Out of managed VLANs";
  return device.networkId ?? "Unknown network";
}

/** The devices a group can take: every Unassigned (quarantined) one, by name. */
export function unassignedDevices(devices: Device[]): Device[] {
  return devices.filter((device) => device.assignment === "quarantined").sort(byDeviceName);
}

/** What assigning devices to a group says, on the web's Devices page and the app's sheet. */
export function assignDevicesCopy(group: Pick<Group, "name">) {
  return {
    needsTitle: `${group.name} needs devices`,
    needsBody: `${group.name} has no assigned devices, so its UniFi policies cannot be created. Assign an unassigned device below.`,
    title: `Assign devices to ${group.name}`,
    assigned: "In this group",
    unassigned: "Unassigned",
    noneWaiting: "No unassigned devices. New devices appear here when they join a managed network.",
    assign: "Assign",
    remove: "Remove",
    done: "Done",
  } as const;
}
