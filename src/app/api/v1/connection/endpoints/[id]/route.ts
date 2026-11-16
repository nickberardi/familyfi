import { ConnectionTransport, EdgeAuth } from "@prisma/client";
import { z } from "zod";
import { deleteEndpoint, updateEndpoint } from "@/server/connection-endpoints";
import { readBody, withAdmin } from "@/server/guard";

const Body = z.object({ url: z.string().min(1).optional(), transport: z.nativeEnum(ConnectionTransport).optional(), trustMode: z.enum(["system", "pinned"]).optional(), spkiSha256: z.string().nullable().optional(), priority: z.number().int().min(0).max(999).optional(), enabled: z.boolean().optional(),
  edgeAuth: z.nativeEnum(EdgeAuth).optional(), serviceToken: z.object({ clientId: z.string(), clientSecret: z.string() }).strict().optional(),
});
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "Provide a valid endpoint update.");
    if (!parsed.ok) return parsed.response;
    const { id } = await context.params;
    return Response.json({ endpoint: await updateEndpoint(id, parsed.data) });
  }, { demoLock: true });
}

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    await deleteEndpoint(id);
    return Response.json({ ok: true });
  }, { demoLock: true });
}
