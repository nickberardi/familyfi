import { FamRuleKind, FamRuleMode, FamRuleScope, type FamRule, type Group } from "@prisma/client";
import { assertSchedule } from "./schedule";
import { networkInScope, type NetworkScope } from "./unifi/scope";

export type PublicRule = {
  id: string;
  kind: "category" | "app";
  scope: "group" | "network";
  groupId: string | null;
  networkIds: string[];
  targetIds: number[];
  enabled: boolean;
  mode: "always" | "scheduled";
  schedule: { enabled: boolean; days: number[]; start: string | null; end: string | null };
  internet: false;
};

export function publicRule(rule: FamRule): PublicRule {
  return {
    id: rule.id,
    kind: rule.kind,
    scope: rule.scope,
    groupId: rule.groupId,
    networkIds: [...rule.networkIds],
    targetIds: [...rule.targetIds],
    enabled: rule.enabled,
    mode: rule.mode,
    schedule: {
      enabled: rule.scheduleEnabled,
      days: [...rule.scheduleDays],
      start: rule.scheduleStart,
      end: rule.scheduleEnd,
    },
    internet: false,
  };
}

export function normalizeTargetIds(kind: FamRuleKind, raw: number[]): number[] {
  const ids = [...new Set(raw.map((n) => Math.trunc(n)).filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => a - b,
  );
  if (ids.length === 0) throw new Error("At least one target id is required.");
  if (kind === FamRuleKind.app && ids.length > 100) {
    throw new Error("App rules may target at most 100 applications.");
  }
  return ids;
}

export function normalizeNetworkIds(raw: string[]): string[] {
  const ids = [...new Set(raw.map((id) => id.trim()).filter(Boolean))].sort();
  if (ids.length === 0) throw new Error("At least one network id is required.");
  return ids;
}

export function assertMutableGroup(group: Group | null): asserts group is Group {
  if (!group) throw Object.assign(new Error("Group not found."), { code: "not_found", status: 404 });
  if (group.protected) {
    throw Object.assign(new Error("Protected groups cannot have category or app rules."), {
      code: "protected",
      status: 409,
    });
  }
}

/** D9: network-scoped rules may only reference Settings-managed network ids. */
export function assertManagedNetworkIds(
  networkIds: string[],
  scope: NetworkScope,
  knownSiteNetworkIds?: Set<string>,
): void {
  const ids = normalizeNetworkIds(networkIds);
  if (scope.manageAllNetworks) {
    if (knownSiteNetworkIds && knownSiteNetworkIds.size === 0) {
      throw Object.assign(new Error("No UniFi networks are available for Network scope."), {
        code: "empty_managed_networks",
        status: 409,
      });
    }
    if (knownSiteNetworkIds) {
      const unknown = ids.filter((id) => !knownSiteNetworkIds.has(id));
      if (unknown.length) {
        throw Object.assign(new Error(`Unknown UniFi network id: ${unknown.join(", ")}`), {
          code: "unmanaged_network",
          status: 400,
        });
      }
    }
    return;
  }
  if (scope.managedNetworkIds.length === 0) {
    throw Object.assign(new Error("Network scope is disabled until managed networks are selected in Settings."), {
      code: "empty_managed_networks",
      status: 409,
    });
  }
  const unmanaged = ids.filter((id) => !networkInScope(scope, id));
  if (unmanaged.length) {
    throw Object.assign(new Error(`Unmanaged network id: ${unmanaged.join(", ")}`), {
      code: "unmanaged_network",
      status: 400,
    });
  }
}

export function parseRuleModeSchedule(input: {
  mode?: "always" | "scheduled";
  schedule?: { enabled: boolean; days: number[]; start: string | null; end: string | null };
}): {
  mode: FamRuleMode;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStart: string | null;
  scheduleEnd: string | null;
} {
  const mode = input.mode === "scheduled" || input.schedule?.enabled ? FamRuleMode.scheduled : FamRuleMode.always;
  if (mode === FamRuleMode.always) {
    return {
      mode,
      scheduleEnabled: false,
      scheduleDays: input.schedule?.days ?? [],
      scheduleStart: input.schedule?.start ?? null,
      scheduleEnd: input.schedule?.end ?? null,
    };
  }
  const schedule = {
    enabled: true,
    days: input.schedule?.days ?? [],
    start: input.schedule?.start ?? "",
    end: input.schedule?.end ?? "",
  };
  assertSchedule(schedule);
  return {
    mode,
    scheduleEnabled: true,
    scheduleDays: schedule.days,
    scheduleStart: schedule.start,
    scheduleEnd: schedule.end,
  };
}

export { FamRuleScope };
