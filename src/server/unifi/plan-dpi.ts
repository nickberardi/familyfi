import { AssignmentState, type RuleKind, type RuleMode, type RuleScope, type GroupKind } from "@prisma/client";
import { networkInScope, type NetworkScope } from "./scope";
import { dpiNetworkRulePolicyName, dpiRulePolicyName } from "./names";
import { toUnifiSchedule } from "./schedule-map";
import type { UnifiFirewallSchedule } from "./types";
import { isSuspended, type Schedule, type Suspension } from "@/lib/schedule";

export type PlanDpiRule = {
  id: string;
  kind: RuleKind;
  scope: RuleScope;
  groupId: string | null;
  networkIds: string[];
  targetIds: number[];
  enabled: boolean;
  mode: RuleMode;
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

export type PlanDpiNetwork = {
  id: string;
  name: string;
  zoneId: string | null;
};

export type PlannedDpiPolicy = {
  key: string;
  ruleId: string;
  groupId: string | null;
  zoneId: string;
  destinationZoneId: string;
  kind: RuleKind;
  targetIds: number[];
  macAddresses: string[];
  networkIds: string[];
  sourceType: "MAC_ADDRESS" | "NETWORK";
  enabled: boolean;
  schedule?: UnifiFirewallSchedule;
  name: string;
};

export function plannedDpiKey(ruleId: string, zoneId: string): string {
  return `rule:${ruleId}|${zoneId}`;
}

export function planDpiPolicies(input: {
  now: Date;
  destinationZoneId: string;
  zoneNames?: Record<string, string>;
  groups: PlanDpiGroup[];
  devices: PlanDpiDevice[];
  networks?: PlanDpiNetwork[];
  networkScope?: NetworkScope;
  rules: PlanDpiRule[];
}): { policies: PlannedDpiPolicy[]; retainRuleIds: Set<string>; orphanRuleIds: Set<string> } {
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const networks = new Map((input.networks ?? []).map((network) => [network.id, network]));
  const networkScope = input.networkScope ?? { manageAllNetworks: true, managedNetworkIds: [] };
  const retainRuleIds = new Set<string>();
  const orphanRuleIds = new Set<string>();
  const groupBuckets = new Map<string, { rule: PlanDpiRule; group: PlanDpiGroup; zoneId: string; macs: string[] }>();
  const networkBuckets = new Map<
    string,
    { rule: PlanDpiRule; zoneId: string; networkIds: string[]; networkNames: string[] }
  >();

  for (const rule of input.rules) {
    if (rule.scope === "network") {
      const inScopeIds = [...new Set(rule.networkIds)]
        .filter((id) => networkInScope(networkScope, id))
        .sort();
      if (inScopeIds.length === 0) {
        // Desired state still lists unmanaged-only networks → treat as orphan for Sync cleanup.
        orphanRuleIds.add(rule.id);
        continue;
      }
      if (inScopeIds.length < rule.networkIds.length) {
        // Partial descope: still plan remaining managed nets; caller should prune DB.
        retainRuleIds.add(rule.id);
      }
      let anyZone = false;
      for (const networkId of inScopeIds) {
        const network = networks.get(networkId);
        if (!network?.zoneId) {
          retainRuleIds.add(rule.id);
          continue;
        }
        anyZone = true;
        const key = plannedDpiKey(rule.id, network.zoneId);
        const bucket = networkBuckets.get(key) ?? {
          rule,
          zoneId: network.zoneId,
          networkIds: [],
          networkNames: [],
        };
        if (!bucket.networkIds.includes(networkId)) {
          bucket.networkIds.push(networkId);
          bucket.networkNames.push(network.name);
        }
        networkBuckets.set(key, bucket);
      }
      if (!anyZone) retainRuleIds.add(rule.id);
      continue;
    }

    // group scope (default)
    if (!rule.groupId) continue;
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
      const bucket = groupBuckets.get(key) ?? { rule, group, zoneId: device.zoneId, macs: [] };
      bucket.macs.push(device.mac);
      groupBuckets.set(key, bucket);
    }
    if (!anyZone) retainRuleIds.add(rule.id);
  }

  const policies: PlannedDpiPolicy[] = [];
  for (const bucket of groupBuckets.values()) {
    if (bucket.macs.length === 0) continue;
    const schedule = ruleSchedule(bucket.rule);
    policies.push({
      key: plannedDpiKey(bucket.rule.id, bucket.zoneId),
      ruleId: bucket.rule.id,
      groupId: bucket.group.id,
      zoneId: bucket.zoneId,
      destinationZoneId: input.destinationZoneId,
      kind: bucket.rule.kind,
      targetIds: [...bucket.rule.targetIds],
      macAddresses: bucket.macs,
      networkIds: [],
      sourceType: "MAC_ADDRESS",
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

  for (const bucket of networkBuckets.values()) {
    if (bucket.networkIds.length === 0) continue;
    const schedule = ruleSchedule(bucket.rule);
    const networkLabel =
      bucket.networkNames.length === 1
        ? bucket.networkNames[0]!
        : `${bucket.networkNames.length} networks`;
    policies.push({
      key: plannedDpiKey(bucket.rule.id, bucket.zoneId),
      ruleId: bucket.rule.id,
      groupId: null,
      zoneId: bucket.zoneId,
      destinationZoneId: input.destinationZoneId,
      kind: bucket.rule.kind,
      targetIds: [...bucket.rule.targetIds],
      macAddresses: [],
      networkIds: [...bucket.networkIds].sort(),
      sourceType: "NETWORK",
      enabled: bucket.rule.enabled,
      schedule: schedule ? toUnifiSchedule(schedule) : undefined,
      name: dpiNetworkRulePolicyName({
        networkLabel,
        ruleKind: bucket.rule.kind,
        zoneName: input.zoneNames?.[bucket.zoneId] ?? bucket.zoneId,
        targetIds: bucket.rule.targetIds,
      }),
    });
  }

  return { policies, retainRuleIds, orphanRuleIds };
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
