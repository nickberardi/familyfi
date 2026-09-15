import type { Account, Device, Group, UnifiSettings } from "@/lib/types";

export type HouseholdLists = {
  groups: Group[];
  devices: Device[];
};

export type HouseholdPublic = {
  timezone: string;
  revision: number;
  quarantineEnforced: boolean;
  quarantineObservedEnabled: boolean | null;
  quarantinePolicyCount: number;
};

export type MutationPayload = {
  change?: { changeId: string; revision?: number };
  group?: Group;
  device?: Device;
  household?: HouseholdPublic;
  account?: Account;
  unifi?: UnifiSettings;
  removedGroupId?: string;
};

export function upsertGroup(groups: Group[], group: Group): Group[] {
  const index = groups.findIndex((item) => item.id === group.id);
  if (index === -1) return [...groups, group];
  const next = groups.slice();
  next[index] = group;
  return next;
}

export function upsertDevice(devices: Device[], device: Device): Device[] {
  const index = devices.findIndex((item) => item.mac === device.mac);
  if (index === -1) return [...devices, device];
  const next = devices.slice();
  next[index] = device;
  return next;
}

function shiftDeviceCount(groups: Group[], fromId: string | null, toId: string | null): Group[] {
  if (fromId === toId) return groups;
  return groups.map((group) => {
    let count = group.deviceCount;
    if (fromId && group.id === fromId) count = Math.max(0, count - 1);
    if (toId && group.id === toId) count += 1;
    return count === group.deviceCount ? group : { ...group, deviceCount: count };
  });
}

export function assignDeviceLocally(state: HouseholdLists, mac: string, groupId: string | null): HouseholdLists {
  const current = state.devices.find((device) => device.mac === mac);
  const previousGroupId = current?.groupId ?? null;
  const devices = state.devices.map((device) =>
    device.mac === mac
      ? { ...device, groupId, assignment: groupId ? ("assigned" as const) : ("quarantined" as const) }
      : device,
  );
  return {
    groups: shiftDeviceCount(state.groups, previousGroupId, groupId),
    devices,
  };
}

export function removeGroupLocally(state: HouseholdLists, groupId: string): HouseholdLists {
  return {
    groups: state.groups.filter((group) => group.id !== groupId),
    devices: state.devices.map((device) =>
      device.groupId === groupId ? { ...device, groupId: null, assignment: "quarantined" } : device,
    ),
  };
}

export function asMutationPayload(value: unknown): MutationPayload {
  if (!value || typeof value !== "object") return {};
  return value as MutationPayload;
}

export function applyMutationResult(state: HouseholdLists, result: MutationPayload): HouseholdLists {
  let next = state;
  if (result.removedGroupId) next = removeGroupLocally(next, result.removedGroupId);
  if (result.device) {
    const device = result.device;
    const previous = next.devices.find((item) => item.mac === device.mac);
    next = {
      groups: shiftDeviceCount(next.groups, previous?.groupId ?? null, device.groupId),
      devices: upsertDevice(next.devices, device),
    };
  }
  if (result.group) next = { ...next, groups: upsertGroup(next.groups, result.group) };
  return next;
}
