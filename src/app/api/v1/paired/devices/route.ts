import { z } from "zod";
import { removeRevokedDevices } from "@/server/connection";
import { prisma } from "@/server/db";
import { withAdmin, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { deviceInclude, publicPairedDevice, visibleDevices } from "@/server/paired-devices";

const Filter = z.object({
  client: z.array(z.enum(["phone", "watch", "agent"])),
  status: z.enum(["active", "revoked"]).optional(),
});

/** Paired devices the caller may see: `?client=` (repeatable) and `?status=active|revoked` narrow it. */
export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const visible = visibleDevices(session as never);
    if (!visible) return jsonError(403, "administrator_required", "A FamilyFi administrator or a paired device is required.");
    const params = new URL(request.url).searchParams;
    const filter = Filter.safeParse({ client: params.getAll("client"), status: params.get("status") ?? undefined });
    if (!filter.success) return jsonError(400, "invalid_request", "client must be phone, watch or agent, and status active or revoked.");
    const { client, status } = filter.data;
    const devices = await prisma().pairedDevice.findMany({
      where: {
        AND: [
          visible,
          client.length ? { client: { in: client } } : {},
          status === "active" ? { revokedAt: null } : status === "revoked" ? { revokedAt: { not: null } } : {},
        ],
      },
      orderBy: { lastSeenAt: "desc" },
      include: deviceInclude(),
    });
    return Response.json({ devices: devices.map(publicPairedDevice) });
  });
}

/** `?status=revoked` deletes every revoked device record. Active devices are never touched. */
export async function DELETE(request: Request) {
  return withAdmin(request, async () => {
    if (new URL(request.url).searchParams.get("status") !== "revoked") {
      return jsonError(400, "invalid_request", "Only revoked devices can be removed in bulk: add ?status=revoked.");
    }
    return Response.json({ removed: await removeRevokedDevices() });
  });
}
