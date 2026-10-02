/**
 * Putting devices in a group, as every client offers it: how a device is named, sorted and placed,
 * and what a group with none is told.
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

/** What a group with no devices is told on the Devices list, opened with `?assign=<group>`. */
export function assignDevicesCopy(group: Pick<Group, "name">) {
  return {
    needsTitle: `${group.name} needs devices`,
    needsBody: `${group.name} has no assigned devices, so its UniFi policies cannot be created. Assign an unassigned device below.`,
  } as const;
}
