import { removeRevokedDevices } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { withAdmin } from "@/server/guard";

function pairedVia(endpoint: { id: string; url: string; transport: string } | null) {
  return endpoint ? { endpointId: endpoint.id, url: endpoint.url, transport: endpoint.transport } : null;
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const devices = await prisma().pairedDevice.findMany({ orderBy: { lastSeenAt: "desc" }, include: { pairings: { include: { endpoint: true }, take: 1 }, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, username: true, expiresAt: true, createdAt: true, parentSessionId: true } } } });
    return Response.json({ devices: devices.map((device) => ({ id: device.id, displayName: device.displayName, enrolledAt: device.createdAt.toISOString(), lastSeenAt: device.lastSeenAt?.toISOString() ?? null, revokedAt: device.revokedAt?.toISOString() ?? null, pairedVia: pairedVia(device.pairings[0]?.endpoint ?? null), sessions: device.sessions.map((session) => ({ id: session.id, username: session.username, client: session.parentSessionId ? "watch" : "phone", expiresAt: session.expiresAt.toISOString(), createdAt: session.createdAt.toISOString() })) })) });
  });
}

/** `?revoked=true` removes every revoked phone's record. Active phones are never touched. */
export async function DELETE(request: Request) {
  return withAdmin(request, async () => {
    if (new URL(request.url).searchParams.get("revoked") !== "true") {
      return jsonError(400, "invalid_request", "Only revoked phones can be removed in bulk: add ?revoked=true.");
    }
    return Response.json({ removed: await removeRevokedDevices() });
  });
}
