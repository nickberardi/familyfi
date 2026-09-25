import { ConnectionTransport, ConnectionTrustMode, EdgeAuth, RouteKind } from "@prisma/client";
import { z } from "zod";
import { publicEndpoint, assertEndpoint, isUniqueViolation } from "@/server/connection";
import { prisma } from "@/server/db";
import { EdgeAuthError, edgeTokenUpdate } from "@/server/edge-auth";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";

const Body = z.object({
  url: z.string().min(1), transport: z.nativeEnum(ConnectionTransport), trustMode: z.nativeEnum(ConnectionTrustMode),
  spkiSha256: z.string().optional(), priority: z.number().int().min(0).max(999).optional(), enabled: z.boolean().optional(),
  edgeAuth: z.nativeEnum(EdgeAuth).optional(), serviceToken: z.object({ clientId: z.string(), clientSecret: z.string() }).strict().optional(),
});

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const endpoints = await prisma().connectionEndpoint.findMany({ where: { householdId: "default" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
    return Response.json({ endpoints: endpoints.map(publicEndpoint) });
  });
}

export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide a valid connection endpoint.");
    const { edgeAuth, serviceToken, ...route } = parsed.data;
    let url: string;
    try {
      url = assertEndpoint(route);
    } catch (error) {
      return jsonError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
    }
    let edge: ReturnType<typeof edgeTokenUpdate>;
    try {
      edge = edgeTokenUpdate(
        { kind: RouteKind.own, transport: route.transport, edgeAuth: EdgeAuth.none, edgeTokenCiphertext: null, edgeTokenIv: null, edgeTokenAuthTag: null, edgeTokenVersion: 0, edgeTokenRotatedAt: null },
        { edgeAuth, serviceToken },
      );
    } catch (error) {
      if (error instanceof EdgeAuthError) return jsonError(error.status, error.code, error.message);
      throw error;
    }
    try {
      // Routes created here are always the household's own; FamilyFi's tunnel routes come from Remote access.
      const endpoint = await prisma().connectionEndpoint.create({ data: { ...route, ...edge.data, url, kind: RouteKind.own } });
      return Response.json({ endpoint: publicEndpoint(endpoint) }, { status: 201 });
    } catch (error) {
      if (isUniqueViolation(error)) return jsonError(409, "endpoint_exists", "A route with this address already exists.");
      throw error;
    }
  });
}
