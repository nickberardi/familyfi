import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    return Response.json({
      revision: household.revision,
      connectionStatus: household.connectionStatus,
      lastRun: run
        ? {
            id: run.id,
            status: run.status,
            requestedRevision: run.requestedRevision,
            appliedRevision: run.appliedRevision,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
            error: run.error,
          }
        : null,
    });
  });
}
