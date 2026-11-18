import { z } from "zod";
import { ME_PROTECTION } from "@/lib/me-protection";
import { isAdministrator } from "@/server/connection";
import { readBody, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { getPairedDevice, revokePairedDevice, setMeProtection, updatePairedDevice } from "@/server/paired-devices";

type Ctx = { params: Promise<{ id: string }> };

const Update = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    scope: z.enum(["agent:full", "agent:readOnly"]).optional(),
    protection: z.enum(ME_PROTECTION).optional(),
  })
  .refine((body) => body.displayName !== undefined || body.scope !== undefined || body.protection !== undefined, "Nothing to change.");

export async function GET(request: Request, context: Ctx) {
  return withSession(request, async (session) => {
    const { id } = await context.params;
    return Response.json({ device: await getPairedDevice(session, id) });
  });
}

/**
 * An administrator renames a device or changes an agent's scope. A child's phone (FamilyFi Me) tells
 * its own Screen Time permission, `protection`, and nothing else; no one else may set it.
 */
export async function PATCH(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    // Anyone but an administrator or the device itself is turned away before its body is read.
    if (!isAdministrator(session) && session.deviceId !== id) return jsonError(403, "administrator_required", "A FamilyFi administrator is required.");
    const parsed = await readBody(request, Update, "Send a displayName, a scope or a protection.");
    if (!parsed.ok) return parsed.response;
    const { protection, ...update } = parsed.data;
    if (protection !== undefined) return Response.json({ device: await setMeProtection(session, id, protection, update) });
    return Response.json({ device: await updatePairedDevice(session, id, update) });
  });
}

/** `?remove=true` (administrator only) deletes the record instead of revoking it. */
export async function DELETE(request: Request, context: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await context.params;
    await revokePairedDevice(session, id, new URL(request.url).searchParams.get("remove") === "true");
    return Response.json({ ok: true });
  });
}
