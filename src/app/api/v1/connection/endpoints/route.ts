import { ConnectionTransport, ConnectionTrustMode, RouteKind } from "@prisma/client";
import { z } from "zod";
import { adminEndpoint, assertEndpoint, isUniqueViolation } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";

const Body = z.object({
  url: z.string().min(1), transport: z.nativeEnum(ConnectionTransport), trustMode: z.nativeEnum(ConnectionTrustMode),
  spkiSha256: z.string().optional(), priority: z.number().int().min(0).max(999).optional(), enabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const endpoints = await prisma().connectionEndpoint.findMany({ where: { householdId: "default" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
    return Response.json({ endpoints: endpoints.map(adminEndpoint) });
  });
}

export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide a valid connection endpoint.");
    let url: string;
    try {
      url = assertEndpoint(parsed.data);
    } catch (error) {
      return jsonError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
    }
    try {
      // Routes created here are always the household's own; FamilyFi's tunnel routes come from Remote access.
      const endpoint = await prisma().connectionEndpoint.create({ data: { ...parsed.data, url, kind: RouteKind.own } });
      return Response.json({ endpoint: adminEndpoint(endpoint) }, { status: 201 });
    } catch (error) {
      if (isUniqueViolation(error)) return jsonError(409, "endpoint_exists", "A route with this address already exists.");
      throw error;
    }
  });
}
