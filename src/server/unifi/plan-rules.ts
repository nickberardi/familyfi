import { AssignmentState, type GroupKind, type RuleKind, type RuleMode, type RuleScope } from "@prisma/client";
import { rulePolicyNames } from "@/lib/policy-names";
import { networkInScope, type NetworkScope } from "./scope";
import { toUnifiSchedule } from "./schedule-map";
import {
  dpiAppBlockPolicy,
  dpiAppNetworkBlockPolicy,
  dpiCategoryBlockPolicy,
  dpiCategoryNetworkBlockPolicy,
  domainBlockPolicy,
  internetBlockPolicy,
} from "./payloads";
import type { FirewallPolicyWrite, UnifiFirewallSchedule } from "./types";

export type PlanRuleWindow = { id: string; position: number; name: string; days: number[]; start: string; end: string };

export type PlanRule = {
  id: string;
  name: string;
  useGeneratedName: boolean;
  kind: RuleKind;
  scope: RuleScope;
  groupIds: string[];
  networkIds: string[];
  targetIds: number[];
  domains: string[];
  enabled: boolean;
  /** A pause is active: the rule's policies stay, disabled, until it ends. */
  paused: boolean;
  mode: RuleMode;
  windows: PlanRuleWindow[];
};

export type PlanRuleGroup = {
  id: string;
  kind: GroupKind;
  /** An allowance is active: the group's devices leave its internet rules' policies. */
  allowed: boolean;
};

export type PlanRuleDevice = {
  mac: string;
  assignment: AssignmentState;
  groupId: string | null;
  zoneId: string | null;
  inScope?: boolean;
};

export type PlanRuleNetwork = {
  id: string;
  name: string;
  zoneId: string | null;
};

/** The window a policy enforces, or this for an always-on rule's one policy. */
export const ALWAYS_WINDOW = "always";

export type PlannedRulePolicy = {
  key: string;
  ruleId: string;
  windowKey: string;
  zoneId: string;
  destinationZoneId: string;
  kind: RuleKind;
  targetIds: number[];
  domains: string[];
  macAddresses: string[];
  networkIds: string[];
  sourceType: "MAC_ADDRESS" | "NETWORK";
  enabled: boolean;
  schedule?: UnifiFirewallSchedule;
  name: string;
};

export function plannedRuleKey(ruleId: string, windowKey: string, zoneId: string): string {
  return `rule:${ruleId}:${windowKey}|${zoneId}`;
}

/**
 * Desired UniFi policies for every rule: one per window (or one for an always-on rule)
 * in each source zone its devices or networks are in. A rule covering several groups
 * puts all their devices in the same policy. A group with an allowance is left out of
 * its internet rules; when that leaves no one, the policy stays with its devices but
 * disabled, so ending the allowance does not create it again. A paused rule keeps every
 * policy the same way, disabled.
 */
export function planRulePolicies(input: {
  destinationZoneId: string;
  zoneNames?: Record<string, string>;
  groups: PlanRuleGroup[];
  devices: PlanRuleDevice[];
  networks?: PlanRuleNetwork[];
  networkScope?: NetworkScope;
  rules: PlanRule[];
}): { policies: PlannedRulePolicy[]; retainRuleIds: Set<string>; orphanRuleIds: Set<string> } {
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const networks = new Map((input.networks ?? []).map((network) => [network.id, network]));
  const networkScope = input.networkScope ?? { manageAllNetworks: true, managedNetworkIds: [] };
  const retainRuleIds = new Set<string>();
  const orphanRuleIds = new Set<string>();
  const policies: PlannedRulePolicy[] = [];
  const zoneName = (zoneId: string) => input.zoneNames?.[zoneId] ?? zoneId;

  for (const rule of input.rules) {
    const windows = ruleWindows(rule);
    if (windows.length === 0) continue;
    const buckets = new Map<string, { macs: string[]; live: string[]; networkIds: string[]; networkNames: string[] }>();
    const bucket = (zoneId: string) => {
      const found = buckets.get(zoneId) ?? { macs: [], live: [], networkIds: [], networkNames: [] };
      buckets.set(zoneId, found);
      return found;
    };

    if (rule.scope === "network") {
      if (rule.kind === "internet") continue;
      const inScopeIds = [...new Set(rule.networkIds)].filter((id) => networkInScope(networkScope, id)).sort();
      if (inScopeIds.length === 0) {
        // Desired state still lists unmanaged-only networks → treat as orphan for Sync cleanup.
        orphanRuleIds.add(rule.id);
        continue;
      }
      // Partial descope: still plan remaining managed nets; caller should prune DB.
      if (inScopeIds.length < rule.networkIds.length) retainRuleIds.add(rule.id);
      for (const networkId of inScopeIds) {
        const network = networks.get(networkId);
        if (!network?.zoneId) {
          retainRuleIds.add(rule.id);
          continue;
        }
        const found = bucket(network.zoneId);
        found.networkIds.push(networkId);
        found.networkNames.push(network.name);
      }
    } else {
      const covered = new Set(rule.groupIds.filter((id) => groups.has(id)));
      const devices = input.devices.filter(
        (device) => device.groupId && covered.has(device.groupId) && device.assignment === AssignmentState.assigned && device.mac,
      );
      // No devices left: the policies go, rather than keep blocking MACs that moved on.
      for (const device of devices) {
        if (device.inScope === false || !device.zoneId) {
          retainRuleIds.add(rule.id);
          continue;
        }
        const found = bucket(device.zoneId);
        found.macs.push(device.mac);
        const lifted = rule.kind === "internet" && groups.get(device.groupId!)!.allowed;
        if (!lifted) found.live.push(device.mac);
      }
    }

    for (const [zoneId, found] of buckets) {
      const names = rulePolicyNames(
        { ...rule, windows: rule.mode === "always" ? [] : windows.map((window) => ({ name: window.name })) },
        zoneName(zoneId),
      );
      const isNetwork = rule.scope === "network";
      if (isNetwork ? found.networkIds.length === 0 : found.macs.length === 0) continue;
      windows.forEach((window, index) => {
        const windowKey = window.id;
        policies.push({
          key: plannedRuleKey(rule.id, windowKey, zoneId),
          ruleId: rule.id,
          windowKey,
          zoneId,
          destinationZoneId: input.destinationZoneId,
          kind: rule.kind,
          targetIds: [...rule.targetIds],
          domains: [...rule.domains],
          macAddresses: isNetwork ? [] : found.live.length ? found.live : found.macs,
          networkIds: isNetwork ? [...found.networkIds].sort() : [],
          sourceType: isNetwork ? "NETWORK" : "MAC_ADDRESS",
          enabled: rule.enabled && !rule.paused && (isNetwork || found.live.length > 0),
          schedule: window.schedule,
          name: names[index]!,
        });
      });
    }
  }

  return { policies, retainRuleIds, orphanRuleIds };
}

function ruleWindows(rule: PlanRule): { id: string; name: string; schedule?: UnifiFirewallSchedule }[] {
  if (rule.mode === "always") {
    // One unscheduled policy; for an internet rule, an allowance still takes a group out.
    return [{ id: ALWAYS_WINDOW, name: "" }];
  }
  return [...rule.windows]
    .sort((a, b) => a.position - b.position)
    .map((window) => ({
      id: window.id,
      name: window.name,
      schedule: toUnifiSchedule({ enabled: true, days: window.days, start: window.start, end: window.end }),
    }));
}

/** The full UniFi write for a planned rule policy. */
export function rulePolicyWrite(planned: PlannedRulePolicy): FirewallPolicyWrite {
  const common = {
    name: planned.name,
    sourceZoneId: planned.zoneId,
    destinationZoneId: planned.destinationZoneId,
    enabled: planned.enabled,
    schedule: planned.schedule,
  };
  const network = planned.sourceType === "NETWORK";
  switch (planned.kind) {
    case "internet":
      return internetBlockPolicy({ ...common, macAddresses: planned.macAddresses });
    case "domain":
      return network
        ? domainBlockPolicy({ ...common, networkIds: planned.networkIds, domains: planned.domains })
        : domainBlockPolicy({ ...common, macAddresses: planned.macAddresses, domains: planned.domains });
    case "category":
      return network
        ? dpiCategoryNetworkBlockPolicy({ ...common, networkIds: planned.networkIds, applicationCategoryIds: planned.targetIds })
        : dpiCategoryBlockPolicy({ ...common, macAddresses: planned.macAddresses, applicationCategoryIds: planned.targetIds });
    case "app":
      return network
        ? dpiAppNetworkBlockPolicy({ ...common, networkIds: planned.networkIds, applicationIds: planned.targetIds })
        : dpiAppBlockPolicy({ ...common, macAddresses: planned.macAddresses, applicationIds: planned.targetIds });
  }
}
