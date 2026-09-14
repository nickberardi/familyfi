import { ChangeStatus } from "@prisma/client";
import { publicChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { deviceScope } from "@/server/devices";
import { withSession } from "@/server/guard";
import { coverageIssues, isWriteFailure } from "@/server/policy-coverage";
import { networkInScope } from "@/server/unifi/scope";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const scope = deviceScope(household);
    const [run, appPolicies, changeRows, groups, devices] = await Promise.all([
      prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma().appPolicy.findMany(),
      prisma().changeResult.findMany({ orderBy: { updatedAt: "desc" }, take: 30 }),
      prisma().group.findMany(),
      prisma().device.findMany(),
    ]);
    const issues = coverageIssues({
      groups,
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      policies: appPolicies,
    });
    const writeIssues = issues.filter(isWriteFailure);
    const policyErrors = appPolicies.filter((policy) => policy.lastError).length;
    const failingCount = policyErrors + writeIssues.length;
    const staleNoMembers =
      failingCount === 0 &&
      run?.status === ChangeStatus.partial &&
      issues.some((issue) => issue.kind === "no_members") &&
      Boolean(run.error);
    const runError = staleNoMembers ? null : (run?.error ?? writeIssues[0]?.message ?? null);
    const runStatus = run
      ? staleNoMembers
        ? "applied"
        : failingCount && run.status === "applied"
          ? "partial"
          : run.status
      : null;
    return Response.json({
      revision: household.revision,
      connectionStatus: household.connectionStatus,
      appPolicyCount: appPolicies.filter((policy) => policy.unifiPolicyId).length,
      failingCount,
      issues,
      lastRun: run
        ? {
            id: run.id,
            status: runStatus,
            requestedRevision: run.requestedRevision,
            appliedRevision: run.appliedRevision,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
            error: runError,
          }
        : null,
      changes: changeRows.map(publicChange),
    });
  });
}
