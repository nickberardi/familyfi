import { prisma } from "@/server/db";
import { withAdmin } from "@/server/guard";

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const devices = await prisma().pairedDevice.findMany({ orderBy: { lastSeenAt: "desc" }, include: { sessions: { where: { revokedAt: null }, select: { id: true, username: true, expiresAt: true, createdAt: true } } } });
    return Response.json({ devices: devices.map((device) => ({ id: device.id, displayName: device.displayName, enrolledAt: device.createdAt.toISOString(), lastSeenAt: device.lastSeenAt?.toISOString() ?? null, revokedAt: device.revokedAt?.toISOString() ?? null, sessions: device.sessions.map((session) => ({ id: session.id, username: session.username, expiresAt: session.expiresAt.toISOString(), createdAt: session.createdAt.toISOString() })) })) });
  });
}
