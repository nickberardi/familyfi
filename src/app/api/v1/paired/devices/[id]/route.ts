import { z } from "zod";
import { readBody, withAdmin, withMutation, withSession } from "@/server/guard";
import { getPairedDevice, revokePairedDevice, updatePairedDevice } from "@/server/paired-devices";

type Ctx = { params: Promise<{ id: string }> };

const Update = z
  .object({ displayName: z.string().trim().min(1).max(80).optional(), scope: z.enum(["agent:full", "agent:readOnly"]).optional() })
  .refine((body) => body.displayName !== undefined || body.scope !== undefined, "Nothing to change.");

export async function GET(request: Request, context: Ctx) {
  return withSession(request, async (session) => {
    const { id } = await context.params;
    return Response.json({ device: await getPairedDevice(session, id) });
  });
}

export async function PATCH(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Update, "Send a displayName or a scope.");
    if (!parsed.ok) return parsed.response;
    const { id } = await context.params;
    return Response.json({ device: await updatePairedDevice(id, parsed.data) });
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
