import { prisma } from "@/server/db";
import { withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { cancelInvite, inviteStatus } from "@/server/pairing";

type Ctx = { params: Promise<{ id: string }> };

/** An invite's status, so the screen that made it can tell when it was claimed. */
export async function GET(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    const invite = await prisma().pairing.findUnique({ where: { id }, include: { claimedDevice: true } });
    if (!invite) return jsonError(404, "not_found", "Invite not found.");
    return Response.json({
      invite: {
        id: invite.id,
        status: inviteStatus(invite),
        expiresAt: invite.expiresAt.toISOString(),
        device: invite.claimedDevice ? { id: invite.claimedDevice.id, displayName: invite.claimedDevice.displayName } : null,
      },
    });
  });
}

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    if (!(await cancelInvite(id))) return jsonError(404, "not_found", "No pending invite with that id.");
    return Response.json({ ok: true });
  });
}
