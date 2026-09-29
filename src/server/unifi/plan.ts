import { AssignmentState } from "@prisma/client";
import { quarantinePolicyName } from "./names";

export type PlannedPolicy = {
  key: string;
  ownerScope: "group" | "quarantine";
  groupId: string | null;
  zoneId: string;
  destinationZoneId: string;
  macAddresses: string[];
  enabled: boolean;
  name: string;
};

export type PlanGroup = { id: string };

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
  destinationZoneId: string;
  zoneNames?: Record<string, string>;
  groups: PlanGroup[];
  devices: PlanDevice[];
  quarantineEnforced?: boolean;
}): { policies: PlannedPolicy[]; retainOwners: Set<string> } {
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const retainOwners = new Set<string>();
  const buckets = new Map<string, { owner: string; zoneId: string; macs: string[] }>();

  for (const device of input.devices) {
    let owner = ownerKey(device);
    if (!owner) continue;
    if (owner.startsWith("group:")) {
      const group = groups.get(device.groupId!);
      if (!group) owner = "quarantine";
      // A group's devices are covered by its rules' policies, not by a policy of the group's own.
      else continue;
    }
    if (device.inScope === false) continue;
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
        enabled: input.quarantineEnforced !== false,
        name: quarantinePolicyName(input.zoneNames?.[bucket.zoneId] ?? bucket.zoneId),
      });
    }
  }

  return { policies, retainOwners };
}

export function plannedKey(ownerScope: "group" | "quarantine", groupId: string | null, zoneId: string): string {
  return ownerScope === "quarantine" ? `quarantine|${zoneId}` : `group:${groupId}|${zoneId}`;
}
