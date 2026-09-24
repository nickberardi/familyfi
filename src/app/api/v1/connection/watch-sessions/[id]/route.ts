import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { isAdministrator } from "@/server/connection";
import { jsonError } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** The provisioning phone or a household administrator may revoke a Watch alone. */
export async function DELETE(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    const watch = await prisma().session.findFirst({
      where: { id, parentSessionId: { not: null } },
      select: { id: true, parentSessionId: true },
    });
    if (!watch) return jsonError(404, "not_found", "Watch session not found.");
    if (watch.parentSessionId !== session.id && !isAdministrator(session as never)) {
      return jsonError(403, "forbidden", "Only the provisioning phone or an administrator can revoke this Watch.");
    }
    await prisma().session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    return Response.json({ ok: true });
  });
}
