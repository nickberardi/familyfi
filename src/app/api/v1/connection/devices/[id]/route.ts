import { PairedDeviceClient, SessionKind } from "@prisma/client";
import { isAdministrator, removeDevice } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { withMutation } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    const administrator = session.device?.client !== PairedDeviceClient.watch && isAdministrator(session as never);
    const ownDevice = session.kind === SessionKind.bearer && session.deviceId === id;
    if (!administrator && !ownDevice) return jsonError(403, "administrator_required", "An administrator or this paired device is required.");
    // ?remove=true deletes the record (revoking first if needed); without it, DELETE revokes as before.
    if (new URL(request.url).searchParams.get("remove") === "true") {
      if (!administrator) return jsonError(403, "administrator_required", "Only an administrator can remove a device record.");
      if (!(await removeDevice(id))) return jsonError(404, "not_found", "Paired device not found.");
      return Response.json({ ok: true });
    }
    const updated = await prisma().pairedDevice.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!updated.count) return jsonError(404, "not_found", "Paired device not found.");
    await prisma().session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return Response.json({ ok: true });
  });
}
