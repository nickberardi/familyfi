import { prisma } from "@/server/db";
import { withAdmin } from "@/server/guard";

function pairedVia(endpoint: { id: string; url: string; transport: string } | null) {
  return endpoint ? { endpointId: endpoint.id, url: endpoint.url, transport: endpoint.transport } : null;
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const devices = await prisma().pairedDevice.findMany({ orderBy: { lastSeenAt: "desc" }, include: { pairings: { include: { endpoint: true }, take: 1 }, sessions: { where: { revokedAt: null }, select: { id: true, username: true, expiresAt: true, createdAt: true } } } });
    return Response.json({ devices: devices.map((device) => ({ id: device.id, displayName: device.displayName, enrolledAt: device.createdAt.toISOString(), lastSeenAt: device.lastSeenAt?.toISOString() ?? null, revokedAt: device.revokedAt?.toISOString() ?? null, pairedVia: pairedVia(device.pairings[0]?.endpoint ?? null), sessions: device.sessions.map((session) => ({ id: session.id, username: session.username, expiresAt: session.expiresAt.toISOString(), createdAt: session.createdAt.toISOString() })) })) });
  });
}
