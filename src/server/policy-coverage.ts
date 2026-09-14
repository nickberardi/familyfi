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
  groups: Array<{ id: string; name: string; protected: boolean; scheduleEnabled: boolean }>;
  devices: Array<{
    groupId: string | null;
    assignment: AssignmentState | string;
    zoneId: string | null;
    inScope?: boolean;
  }>;
  policies: Array<{ groupId: string | null; unifiPolicyId: string | null; lastError: string | null }>;
}): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const group of input.groups) {
    if (group.protected) continue;
    const live = input.policies.some((policy) => policy.groupId === group.id && policy.unifiPolicyId && !policy.lastError);
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
    if (group.scheduleEnabled) {
      issues.push({
        groupId: group.id,
        groupName: group.name,
        kind: "no_members",
        message: `${group.name} has a bedtime but no assigned devices, so a UniFi policy cannot be created.`,
      });
    }
  }
  return issues;
}
