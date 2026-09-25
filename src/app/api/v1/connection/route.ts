import { signedEndpointManifest } from "@/server/connection";
import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const [household, lastRun, lastChange] = await Promise.all([
      prisma().household.findUniqueOrThrow({ where: { id: "default" } }),
      prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma().changeResult.findFirst({ where: { actorAccountId: session.accountId ?? undefined }, orderBy: { updatedAt: "desc" } }),
    ]);
    const manifest = await signedEndpointManifest({ deviceId: session.deviceId });
    return Response.json({
      endpoints: manifest.endpoints,
      endpointManifest: manifest,
      unifi: { status: household.connectionStatus, error: household.connectionError, lastSyncAt: lastRun?.finishedAt?.toISOString() ?? lastRun?.startedAt?.toISOString() ?? null },
      lastChange: lastChange ? { id: lastChange.id, scope: lastChange.scope, status: lastChange.status, error: lastChange.error, updatedAt: lastChange.updatedAt.toISOString() } : null,
    });
  });
}
