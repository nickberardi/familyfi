import { cancelPairing, pairingStatus } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { withAdmin } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    const pairing = await prisma().pairing.findUnique({ where: { id }, include: { claimedDevice: true } });
    if (!pairing) return jsonError(404, "not_found", "Pairing not found.");
    return Response.json({
      pairing: {
        id: pairing.id,
        status: pairingStatus(pairing),
        expiresAt: pairing.expiresAt.toISOString(),
        device: pairing.claimedDevice ? { id: pairing.claimedDevice.id, displayName: pairing.claimedDevice.displayName } : null,
      },
    });
  });
}

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    if (!(await cancelPairing(id))) return jsonError(404, "not_found", "No pending pairing with that id.");
    return Response.json({ ok: true });
  });
}
