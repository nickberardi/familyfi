import { AssignmentState, type FamRuleKind, type FamRuleMode, type GroupKind } from "@prisma/client";
import { isSuspended, type Schedule, type Suspension } from "../schedule";
import { dpiRulePolicyName } from "./names";
import { toUnifiSchedule } from "./schedule-map";
import type { UnifiFirewallSchedule } from "./types";

export type PlanDpiRule = {
  id: string;
  kind: FamRuleKind;
  groupId: string;
  targetIds: number[];
  enabled: boolean;
  mode: FamRuleMode;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStart: string | null;
  scheduleEnd: string | null;
};

export type PlanDpiGroup = {
  id: string;
  name: string;
  kind: GroupKind;
  protected: boolean;
};

export type PlanDpiDevice = {
  mac: string;
  assignment: AssignmentState;
  groupId: string | null;
  zoneId: string | null;
  inScope?: boolean;
};

export type PlannedDpiPolicy = {
  key: string;
  famRuleId: string;
  groupId: string;
  zoneId: string;
  destinationZoneId: string;
  kind: FamRuleKind;
  targetIds: number[];
  macAddresses: string[];
  enabled: boolean;
  schedule?: UnifiFirewallSchedule;
  name: string;
};

export function plannedDpiKey(famRuleId: string, zoneId: string): string {
  return `famRule:${famRuleId}|${zoneId}`;
}

export function planDpiPolicies(input: {
  now: Date;
  destinationZoneId: string;
  zoneNames?: Record<string, string>;
  groups: PlanDpiGroup[];
  devices: PlanDpiDevice[];
  rules: PlanDpiRule[];
}): { policies: PlannedDpiPolicy[]; retainRuleIds: Set<string> } {
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const retainRuleIds = new Set<string>();
  const buckets = new Map<string, { rule: PlanDpiRule; group: PlanDpiGroup; zoneId: string; macs: string[] }>();

  for (const rule of input.rules) {
    const group = groups.get(rule.groupId);
    if (!group || group.protected) continue;
    const devices = input.devices.filter(
      (device) =>
        device.groupId === rule.groupId &&
        device.assignment === AssignmentState.assigned &&
        device.mac,
    );
    if (devices.length === 0) {
      retainRuleIds.add(rule.id);
      continue;
    }
    let anyZone = false;
    for (const device of devices) {
      if (device.inScope === false) {
        retainRuleIds.add(rule.id);
        continue;
      }
      if (!device.zoneId) {
        retainRuleIds.add(rule.id);
        continue;
      }
      anyZone = true;
      const key = plannedDpiKey(rule.id, device.zoneId);
      const bucket = buckets.get(key) ?? { rule, group, zoneId: device.zoneId, macs: [] };
      bucket.macs.push(device.mac);
      buckets.set(key, bucket);
    }
    if (!anyZone) retainRuleIds.add(rule.id);
  }

  const policies: PlannedDpiPolicy[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.macs.length === 0) continue;
    const schedule = ruleSchedule(bucket.rule);
    policies.push({
      key: plannedDpiKey(bucket.rule.id, bucket.zoneId),
      famRuleId: bucket.rule.id,
      groupId: bucket.group.id,
      zoneId: bucket.zoneId,
      destinationZoneId: input.destinationZoneId,
      kind: bucket.rule.kind,
      targetIds: [...bucket.rule.targetIds],
      macAddresses: bucket.macs,
      enabled: bucket.rule.enabled,
      schedule: schedule ? toUnifiSchedule(schedule) : undefined,
      name: dpiRulePolicyName({
        groupName: bucket.group.name,
        kind: bucket.group.kind,
        ruleKind: bucket.rule.kind,
        zoneName: input.zoneNames?.[bucket.zoneId] ?? bucket.zoneId,
        targetIds: bucket.rule.targetIds,
      }),
    });
  }

  return { policies, retainRuleIds };
}

function ruleSchedule(rule: PlanDpiRule): Schedule | null {
  if (rule.mode === "always") return null;
  if (!rule.scheduleEnabled || !rule.scheduleStart || !rule.scheduleEnd) return null;
  return {
    enabled: true,
    days: rule.scheduleDays,
    start: rule.scheduleStart,
    end: rule.scheduleEnd,
  };
}

/** Unused helper kept for parity with internet suspension (rules use their own enabled flag). */
export function ruleEffectiveEnabled(rule: PlanDpiRule, suspension: Suspension, now: Date): boolean {
  if (!rule.enabled) return false;
  if (isSuspended(suspension, now)) return rule.enabled;
  return rule.enabled;
}
