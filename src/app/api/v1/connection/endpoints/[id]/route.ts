import { z } from "zod";
import { assertEndpoint, hasPendingPairing, isUniqueViolation, publicEndpoint } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";

const Body = z.object({ url: z.string().min(1).optional(), transport: z.enum(["lan", "vpn", "reverseProxy", "tailscale", "cloudflare"]).optional(), trustMode: z.enum(["system", "pinned"]).optional(), spkiSha256: z.string().nullable().optional(), priority: z.number().int().min(0).max(999).optional(), enabled: z.boolean().optional() });
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide a valid endpoint update.");
    const { id } = await context.params;
    const current = await prisma().connectionEndpoint.findUnique({ where: { id } });
    if (!current) return jsonError(404, "not_found", "Connection endpoint not found.");
    const trustMode = parsed.data.trustMode ?? current.trustMode;
    const transport = parsed.data.transport ?? current.transport;
    const spkiSha256 = parsed.data.spkiSha256 === undefined ? current.spkiSha256 : parsed.data.spkiSha256;
    let url: string;
    try {
      url = assertEndpoint({ url: parsed.data.url ?? current.url, transport, trustMode, spkiSha256 });
    } catch (error) {
      return jsonError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
    }
    try {
      const endpoint = await prisma().connectionEndpoint.update({ where: { id }, data: { ...parsed.data, url, transport, trustMode, spkiSha256 } });
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
    if (await hasPendingPairing(id)) {
      return jsonError(409, "endpoint_in_use", "A pairing code for this route is still active. Cancel it or wait for it to expire.");
    }
    const deleted = await prisma().connectionEndpoint.deleteMany({ where: { id } });
    if (!deleted.count) return jsonError(404, "not_found", "Connection endpoint not found.");
    return Response.json({ ok: true });
  });
}
