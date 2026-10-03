import { z } from "zod";
import { isAdministrator, removeDevice } from "@/server/connection";
import { prisma } from "@/server/db";
import { isValidScope } from "@/server/device-scope";
import { readJson, withAdmin, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { deviceInclude, publicPairedDevice, visibleDevices } from "@/server/paired-devices";

type Ctx = { params: Promise<{ id: string }> };

const Update = z
  .object({ displayName: z.string().trim().min(1).max(80).optional(), scope: z.enum(["full", "rulesOnly", "readOnly"]).optional() })
  .refine((body) => body.displayName !== undefined || body.scope !== undefined, "Nothing to change.");

export async function GET(request: Request, context: Ctx) {
  return withSession(request, async (session) => {
    const visible = visibleDevices(session as never);
    if (!visible) return jsonError(403, "administrator_required", "A FamilyFi administrator or a paired device is required.");
    const { id } = await context.params;
    const device = await prisma().pairedDevice.findFirst({ where: { AND: [visible, { id }] }, include: deviceInclude() });
    if (!device) return jsonError(404, "not_found", "Paired device not found.");
    return Response.json({ device: publicPairedDevice(device) });
  });
}

/** Rename a paired device or change its scope; the scope must stay valid for its kind (in practice, an agent's). */
export async function PATCH(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Update.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Send a displayName or a scope.");
    const { id } = await context.params;
    const device = await prisma().pairedDevice.findUnique({ where: { id } });
    if (!device) return jsonError(404, "not_found", "Paired device not found.");
    if (parsed.data.scope && !isValidScope(device.client, parsed.data.scope)) {
      return jsonError(400, "invalid_scope", `A ${device.client} cannot hold the ${parsed.data.scope} scope.`);
    }
    await prisma().pairedDevice.update({ where: { id }, data: parsed.data });
    const updated = await prisma().pairedDevice.findUniqueOrThrow({ where: { id }, include: deviceInclude() });
    return Response.json({ device: publicPairedDevice(updated) });
  });
}

/** Revoke a paired device: an administrator, the device itself, or the phone that vouched for it. `?remove=true` (administrator only) deletes the record. */
export async function DELETE(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    const administrator = isAdministrator(session as never);
    const device = await prisma().pairedDevice.findUnique({ where: { id }, select: { parentDeviceId: true } });
    const own = Boolean(session.deviceId) && session.deviceId === id;
    const parent = Boolean(session.deviceId) && device?.parentDeviceId === session.deviceId;
    if (!administrator && !own && !parent) return jsonError(403, "administrator_required", "An administrator, this paired device or its phone is required.");
    if (new URL(request.url).searchParams.get("remove") === "true") {
      if (!administrator) return jsonError(403, "administrator_required", "Only an administrator can remove a device record.");
      if (!(await removeDevice(id))) return jsonError(404, "not_found", "Paired device not found.");
      return Response.json({ ok: true });
    }
    const now = new Date();
    const updated = await prisma().pairedDevice.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
    if (!updated.count) return jsonError(404, "not_found", "Paired device not found.");
    await prisma().session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: now } });
    return Response.json({ ok: true });
  });
}
