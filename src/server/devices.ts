import { AssignmentState } from "@prisma/client";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { normalizeMac } from "./mac";
import { networkInScope, type NetworkScope } from "./unifi/scope";

export function deviceScope(household: {
  unifiManageAllNetworks: boolean;
  unifiManagedNetworkIds: string[];
}): NetworkScope {
  return {
    manageAllNetworks: household.unifiManageAllNetworks,
    managedNetworkIds: household.unifiManagedNetworkIds,
  };
}

export function publicDevice(
  device: {
    mac: string;
    hostname: string | null;
    ip: string | null;
    networkId: string | null;
    zoneId: string | null;
    groupId: string | null;
    assignment: AssignmentState;
    lastSeenAt: Date | null;
    presenceOnline: boolean | null;
    presenceCheckedAt: Date | null;
    connectedAt: Date | null;
    connectionType: string | null;
    accessPointName: string | null;
    manufacturer: string | null;
    createdAt: Date;
  },
  scope?: NetworkScope,
  now = new Date(),
  /** `Household.presenceCheckedAt`: the last pass checked every device that existed then. */
  sweptAt: Date | null = null,
) {
  const inScope = scope ? networkInScope(scope, device.networkId) : true;
  const swept = sweptAt && device.presenceOnline === false && device.presenceCheckedAt && device.createdAt <= sweptAt && sweptAt > device.presenceCheckedAt;
  const checkedAt = swept ? sweptAt : device.presenceCheckedAt;
  const stale = checkedAt && now.getTime() - checkedAt.getTime() > 90_000;
  const presence = device.presenceOnline === null || !checkedAt
    ? "unknown"
    : device.presenceOnline
      ? stale ? "stale_online" : "online"
      : stale ? "stale_offline" : "offline";
  return {
    mac: device.mac,
    manufacturer: device.manufacturer,
    hostname: device.hostname,
    ip: device.ip,
    networkId: device.networkId,
    zoneId: device.zoneId,
    groupId: device.groupId,
    assignment: device.assignment,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    presence,
    presenceCheckedAt: checkedAt?.toISOString() ?? null,
    connectedAt: device.connectedAt?.toISOString() ?? null,
    connectionType: device.connectionType,
    accessPointName: device.accessPointName,
    unresolved: !device.zoneId,
    inScope,
  };
}

function deviceNotFound() {
  return new ApiError(404, "not_found", "Device not found.");
}

/** The MAC address a request's path names, percent-encoded as it arrives. */
export function deviceMac(raw: string): string {
  try {
    return normalizeMac(decodeURIComponent(raw));
  } catch {
    throw new ApiError(400, "invalid_mac", "MAC address must contain 12 hex digits.");
  }
}

async function present(device: Parameters<typeof publicDevice>[0]) {
  const household = await loadHousehold();
  return publicDevice(device, deviceScope(household), new Date(), household.presenceCheckedAt);
}

/** Every device, or only the `quarantined` or `assigned` ones. */
export async function listDevices(assignment: string | null) {
  const household = await loadHousehold();
  const devices = await prisma().device.findMany({
    where:
      assignment === "quarantined"
        ? { assignment: AssignmentState.quarantined }
        : assignment === "assigned"
          ? { assignment: AssignmentState.assigned }
          : {},
    orderBy: { mac: "asc" },
  });
  return devices.map((device) => publicDevice(device, deviceScope(household), new Date(), household.presenceCheckedAt));
}

export async function getDevice(mac: string) {
  const household = await loadHousehold();
  const device = await prisma().device.findUnique({ where: { mac } });
  if (!device) throw deviceNotFound();
  return publicDevice(device, deviceScope(household), new Date(), household.presenceCheckedAt);
}

export async function forgetDevice(mac: string) {
  const removed = await prisma().device.deleteMany({ where: { mac } });
  if (removed.count === 0) throw deviceNotFound();
  return { change: await enqueueChange("device", mac) };
}

/** Assigns a device to a group, or with null puts it back in quarantine. */
export async function assignDevice(mac: string, groupId: string | null) {
  const existing = await prisma().device.findUnique({ where: { mac } });
  if (!existing) throw deviceNotFound();
  if (groupId) {
    const group = await prisma().group.findUnique({ where: { id: groupId } });
    if (!group) throw new ApiError(404, "not_found", "Group not found.");
  }
  const device = await prisma().device.update({
    where: { mac },
    data: { groupId, assignment: groupId ? AssignmentState.assigned : AssignmentState.quarantined },
  });
  const change = await enqueueChange("assignment", mac);
  return { device: await present(device), change };
}
