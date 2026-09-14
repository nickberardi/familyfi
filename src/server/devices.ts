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
  },
  scope?: NetworkScope,
) {
  const inScope = scope ? networkInScope(scope, device.networkId) : true;
  return {
    mac: device.mac,
    hostname: device.hostname,
    ip: device.ip,
    networkId: device.networkId,
    zoneId: device.zoneId,
    groupId: device.groupId,
    assignment: device.assignment,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    unresolved: !device.zoneId,
    inScope,
  };
}
