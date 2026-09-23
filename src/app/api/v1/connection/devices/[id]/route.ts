import { removeDevice } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { withAdmin } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    // ?remove=true deletes the record (revoking first if needed); without it, DELETE revokes as before.
    if (new URL(request.url).searchParams.get("remove") === "true") {
      if (!(await removeDevice(id))) return jsonError(404, "not_found", "Paired device not found.");
      return Response.json({ ok: true });
    }
    const updated = await prisma().pairedDevice.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!updated.count) return jsonError(404, "not_found", "Paired device not found.");
    await prisma().session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return Response.json({ ok: true });
  });
}
