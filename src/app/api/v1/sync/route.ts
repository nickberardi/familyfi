import { ChangeStatus } from "@prisma/client";
import { publicChange } from "@/server/changes";
import { checkupProblemCount } from "@/server/checkup";
import { prisma } from "@/server/db";
import { deviceScope } from "@/server/devices";
import { withSession } from "@/server/guard";
import { isWriteFailure, storedCoverage } from "@/server/policy-coverage";
import { networkInScope } from "@/server/unifi/scope";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const scope = deviceScope(household);
    // Every policy FamilyFi owns: pause and quarantine policies, and one per rule window. Counted, not
    // loaded: every open page and phone polls this.
    const live = { unifiPolicyId: { not: null } };
    const failing = { lastError: { not: null } };
    const [run, liveCounts, errorCounts, changeRows, coverage, checkupProblems] = await Promise.all([
      prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      Promise.all([prisma().appPolicy.count({ where: live }), prisma().rulePolicy.count({ where: live })]),
      Promise.all([prisma().appPolicy.count({ where: failing }), prisma().rulePolicy.count({ where: failing })]),
      prisma().changeResult.findMany({ orderBy: { updatedAt: "desc" }, take: 30 }),
      storedCoverage({ now: new Date(), deviceInScope: (networkId) => networkInScope(scope, networkId) }),
      checkupProblemCount(),
    ]);
    const { issues } = coverage;
    const writeIssues = issues.filter(isWriteFailure);
    const policyErrors = errorCounts[0] + errorCounts[1];
    const failingCount = policyErrors + writeIssues.length;
    const staleNoMembers =
      failingCount === 0 &&
      run?.status === ChangeStatus.partial &&
      issues.some((issue) => issue.kind === "no_members") &&
      Boolean(run.error);
    // While the sweep after a lost connection is still running, the error that lost it still holds.
    const connectionError =
      run?.status === ChangeStatus.pending && household.connectionStatus === "error" ? household.connectionError : null;
    const runError = staleNoMembers ? null : (run?.error ?? connectionError ?? writeIssues[0]?.message ?? null);
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
      appPolicyCount: liveCounts[0] + liveCounts[1],
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
      checkupProblems,
    });
  });
}
