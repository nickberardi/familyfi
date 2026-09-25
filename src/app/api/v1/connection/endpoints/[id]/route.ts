import { ConnectionTransport, EdgeAuth } from "@prisma/client";
import { z } from "zod";
import { publicEndpoint, assertEndpoint, hasPendingPairing, isManagedRoute, isUniqueViolation } from "@/server/connection";
import { prisma } from "@/server/db";
import { EdgeAuthError, edgeTokenUpdate } from "@/server/edge-auth";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";

const Body = z.object({ url: z.string().min(1).optional(), transport: z.nativeEnum(ConnectionTransport).optional(), trustMode: z.enum(["system", "pinned"]).optional(), spkiSha256: z.string().nullable().optional(), priority: z.number().int().min(0).max(999).optional(), enabled: z.boolean().optional(),
  edgeAuth: z.nativeEnum(EdgeAuth).optional(), serviceToken: z.object({ clientId: z.string(), clientSecret: z.string() }).strict().optional(),
});
type Ctx = { params: Promise<{ id: string }> };

const MANAGED = "This route follows FamilyFi's own tunnel. Change it from Remote access instead.";

export async function PUT(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide a valid endpoint update.");
    const { id } = await context.params;
    const current = await prisma().connectionEndpoint.findUnique({ where: { id } });
    if (!current) return jsonError(404, "not_found", "Connection endpoint not found.");
    if (isManagedRoute(current)) return jsonError(409, "managed_route", MANAGED);
    const { edgeAuth, serviceToken, ...changes } = parsed.data;
    const trustMode = changes.trustMode ?? current.trustMode;
    const transport = changes.transport ?? current.transport;
    const spkiSha256 = changes.spkiSha256 === undefined ? current.spkiSha256 : changes.spkiSha256;
    let url: string;
    try {
      url = assertEndpoint({ url: changes.url ?? current.url, transport, trustMode, spkiSha256 });
    } catch (error) {
      return jsonError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
    }
    let edge: ReturnType<typeof edgeTokenUpdate>;
    try {
      edge = edgeTokenUpdate({ ...current, transport }, { edgeAuth, serviceToken });
    } catch (error) {
      if (error instanceof EdgeAuthError) return jsonError(error.status, error.code, error.message);
      throw error;
    }
    try {
      const endpoint = await prisma().$transaction(async (db) => {
        // With Access off, nobody holds a token for this route any more.
        if (edge.cleared) await db.deviceEdgeToken.deleteMany({ where: { endpointId: id } });
        return db.connectionEndpoint.update({ where: { id }, data: { ...changes, ...edge.data, url, transport, trustMode, spkiSha256 } });
      });
      return Response.json({ endpoint: publicEndpoint(endpoint) });
    } catch (error) {
      if (isUniqueViolation(error)) return jsonError(409, "endpoint_exists", "A route with this address already exists.");
      throw error;
    }
  });
}

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    const current = await prisma().connectionEndpoint.findUnique({ where: { id } });
    if (!current) return jsonError(404, "not_found", "Connection endpoint not found.");
    if (isManagedRoute(current)) return jsonError(409, "managed_route", MANAGED);
    if (await hasPendingPairing(id)) {
      return jsonError(409, "endpoint_in_use", "A pairing code for this route is still active. Cancel it or wait for it to expire.");
    }
    // Deleting the published route leaves nothing published: remote access is Off.
    const deleted = await prisma().$transaction(async (db) => {
      await db.household.updateMany({ where: { id: "default", remoteEndpointId: id }, data: { remoteEndpointId: null } });
      return db.connectionEndpoint.deleteMany({ where: { id } });
    });
    if (!deleted.count) return jsonError(404, "not_found", "Connection endpoint not found.");
    return Response.json({ ok: true });
  });
}
