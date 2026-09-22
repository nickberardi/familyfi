import { z } from "zod";
import { createPairing } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";

const Body = z.object({ endpointId: z.string().min(1), deviceName: z.string().trim().min(1).max(80) });

export async function POST(request: Request) {
  return withAdmin(request, async (session) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Endpoint and phone name are required.");
    const endpoint = await prisma().connectionEndpoint.findFirst({ where: { id: parsed.data.endpointId, householdId: "default", enabled: true } });
    if (!endpoint || !session.accountId) return jsonError(404, "not_found", "Connection endpoint not found.");
    const { pairing, qr } = await createPairing({ endpointId: endpoint.id, displayName: parsed.data.deviceName, createdByAccountId: session.accountId });
    return Response.json({ pairing: { id: pairing.id, expiresAt: pairing.expiresAt.toISOString(), qr }, }, { status: 201 });
  });
}
