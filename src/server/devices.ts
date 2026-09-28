import { AssignmentState } from "@prisma/client";
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
  },
  scope?: NetworkScope,
  now = new Date(),
) {
  const inScope = scope ? networkInScope(scope, device.networkId) : true;
  const checkedAt = device.presenceCheckedAt;
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
