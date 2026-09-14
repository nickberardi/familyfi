import { AssignmentState, GroupKind } from "@prisma/client";
import { isSuspended, type Schedule, type Suspension } from "../schedule";
import { groupPolicyName, quarantinePolicyName } from "./names";
import { toUnifiSchedule } from "./schedule-map";
import type { UnifiFirewallSchedule } from "./types";

export type PlannedPolicy = {
  key: string;
  ownerScope: "group" | "quarantine";
  groupId: string | null;
  zoneId: string;
  destinationZoneId: string;
  macAddresses: string[];
  enabled: boolean;
  schedule?: UnifiFirewallSchedule;
  name: string;
};

export type PlanGroup = {
  id: string;
  name: string;
  kind: GroupKind;
  protected: boolean;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStart: string | null;
  scheduleEnd: string | null;
  suspensionActive: boolean;
  suspensionUntil: Date | null;
};

function ownerKey(device: PlanDevice): string | null {
  if (device.assignment === AssignmentState.quarantined || !device.groupId) return "quarantine";
  return `group:${device.groupId}`;
}

export type PlanDevice = {
  mac: string;
  assignment: AssignmentState;
  groupId: string | null;
  zoneId: string | null;
  inScope?: boolean;
};

export function planPolicies(input: {
  installId: string;
  now: Date;
  destinationZoneId: string;
  zoneNames?: Record<string, string>;
  groups: PlanGroup[];
  devices: PlanDevice[];
}): { policies: PlannedPolicy[]; retainOwners: Set<string> } {
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const buckets = new Map<string, { owner: string; zoneId: string; macs: string[] }>();
  const retainOwners = new Set<string>();

  for (const device of input.devices) {
    let owner = ownerKey(device);
    if (!owner) continue;
    if (owner.startsWith("group:")) {
      const group = groups.get(device.groupId!);
      if (!group) owner = "quarantine";
      else if (group.protected) continue;
    }
    if (device.inScope === false) {
      if (owner.startsWith("group:")) retainOwners.add(owner);
      continue;
    }
    if (!device.zoneId) {
      retainOwners.add(owner);
      continue;
    }
    const bucketKey = `${owner}|${device.zoneId}`;
    const bucket = buckets.get(bucketKey) ?? { owner, zoneId: device.zoneId, macs: [] };
    bucket.macs.push(device.mac);
    buckets.set(bucketKey, bucket);
  }

  const policies: PlannedPolicy[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.macs.length === 0) continue;
    if (bucket.owner === "quarantine") {
      policies.push({
        key: bucket.owner + "|" + bucket.zoneId,
        ownerScope: "quarantine",
        groupId: null,
        zoneId: bucket.zoneId,
        destinationZoneId: input.destinationZoneId,
        macAddresses: bucket.macs,
        enabled: true,
        name: quarantinePolicyName(input.zoneNames?.[bucket.zoneId] ?? bucket.zoneId),
      });
      continue;
    }
    const groupId = bucket.owner.slice("group:".length);
    const group = groups.get(groupId);
    if (!group || group.protected) continue;
    const schedule = groupSchedule(group);
    const suspension: Suspension = { active: group.suspensionActive, until: group.suspensionUntil };
    policies.push({
      key: bucket.owner + "|" + bucket.zoneId,
      ownerScope: "group",
      groupId,
      zoneId: bucket.zoneId,
      macAddresses: bucket.macs,
      enabled: !isSuspended(suspension, input.now),
      schedule: toUnifiSchedule(schedule),
      name: groupPolicyName({
        name: group.name,
        kind: group.kind,
        zoneName: input.zoneNames?.[bucket.zoneId] ?? bucket.zoneId,
      }),
      destinationZoneId: input.destinationZoneId,
    });
  }

  return { policies, retainOwners };
}

function groupSchedule(group: PlanGroup): Schedule {
  if (!group.scheduleEnabled || !group.scheduleStart || !group.scheduleEnd) {
    return { enabled: false, days: [], start: "21:00", end: "07:00" };
  }
  return {
    enabled: true,
    days: group.scheduleDays,
    start: group.scheduleStart,
    end: group.scheduleEnd,
  };
}

export function plannedKey(ownerScope: "group" | "quarantine", groupId: string | null, zoneId: string): string {
  return ownerScope === "quarantine" ? `quarantine|${zoneId}` : `group:${groupId}|${zoneId}`;
}
