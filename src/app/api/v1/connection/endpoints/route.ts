import { ConnectionTransport, ConnectionTrustMode } from "@prisma/client";
import { z } from "zod";
import { assertEndpoint, publicEndpoint } from "@/server/connection";
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
    return Response.json({ endpoints: endpoints.map(publicEndpoint) });
  });
}

export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide a valid connection endpoint.");
    try {
      const url = assertEndpoint(parsed.data);
      const endpoint = await prisma().connectionEndpoint.create({ data: { ...parsed.data, url } });
      return Response.json({ endpoint: publicEndpoint(endpoint) }, { status: 201 });
    } catch (error) {
      return jsonError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
    }
  });
}
