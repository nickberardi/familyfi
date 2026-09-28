import { AssignmentState } from "@prisma/client";

export type CoverageKind = "no_members" | "unresolved_zone" | "missing_policy";

export type CoverageIssue = {
  groupId: string;
  groupName: string;
  kind: CoverageKind;
  message: string;
};

export function isWriteFailure(issue: CoverageIssue): boolean {
  return issue.kind !== "no_members";
}

export function coverageIssues(input: {
  /** `enforced`: the group is paused or covered by an enabled rule, so UniFi needs a policy for it. */
  groups: Array<{ id: string; name: string; protected: boolean; enforced: boolean }>;
  devices: Array<{
    groupId: string | null;
    assignment: AssignmentState | string;
    zoneId: string | null;
    inScope?: boolean;
  }>;
  /** Each recorded policy with the groups whose devices it covers. */
  policies: Array<{ groupIds: string[]; unifiPolicyId: string | null; lastError: string | null }>;
}): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const group of input.groups) {
    if (group.protected || !group.enforced) continue;
    const live = input.policies.some(
      (policy) => policy.groupIds.includes(group.id) && policy.unifiPolicyId && !policy.lastError,
    );
    if (live) continue;
    const assigned = input.devices.filter(
      (device) => device.groupId === group.id && device.assignment === AssignmentState.assigned,
    );
    const usable = assigned.filter((device) => Boolean(device.zoneId) && device.inScope !== false);
    if (usable.length > 0) {
      issues.push({
        groupId: group.id,
        groupName: group.name,
        kind: "missing_policy",
        message: `${group.name} has no UniFi policy.`,
      });
      continue;
    }
    if (assigned.length > 0) {
      issues.push({
        groupId: group.id,
        groupName: group.name,
        kind: "unresolved_zone",
        message: `${group.name}'s assigned devices have no firewall zone, so UniFi has no policy.`,
      });
      continue;
    }
    issues.push({
      groupId: group.id,
      groupName: group.name,
      kind: "no_members",
      message: `${group.name} has rules but no assigned devices, so a UniFi policy cannot be created.`,
    });
  }
  return issues;
}

/**
 * The coverage inputs as stored: which groups need a policy (paused, or covered by an
 * enabled rule) and which recorded policies cover each group. `policies` narrows to one
 * console and site when reconciliation asks.
 */
export async function storedCoverage(input: {
  now: Date;
  deviceInScope: (networkId: string | null) => boolean;
  policyScope?: { connectionIdentity: string; siteId: string };
}): Promise<{ issues: CoverageIssue[] }> {
  const { prisma } = await import("./db");
  const { isSuspended } = await import("@/lib/schedule");
  const [groups, devices, rules, pauses, rulePolicies] = await Promise.all([
    prisma().group.findMany(),
    prisma().device.findMany(),
    prisma().rule.findMany({ include: { groups: true } }),
    prisma().appPolicy.findMany({ where: { ...input.policyScope, ownerScope: "group" } }),
    prisma().rulePolicy.findMany({ where: input.policyScope }),
  ]);
  const ruleGroups = new Map(rules.map((rule) => [rule.id, rule.groups.map((link) => link.groupId)]));
  const ruled = new Set(rules.filter((rule) => rule.enabled).flatMap((rule) => ruleGroups.get(rule.id) ?? []));
  const issues = coverageIssues({
    groups: groups.map((group) => ({
      ...group,
      enforced: ruled.has(group.id) || isSuspended({ active: group.suspensionActive, until: group.suspensionUntil }, input.now),
    })),
    devices: devices.map((device) => ({ ...device, inScope: input.deviceInScope(device.networkId) })),
    policies: [
      ...pauses.map((row) => ({ ...row, groupIds: row.groupId ? [row.groupId] : [] })),
      ...rulePolicies.map((row) => ({ ...row, groupIds: ruleGroups.get(row.ruleId) ?? [] })),
    ],
  });
  return { issues };
}
