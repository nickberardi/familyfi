import { z } from "zod";
import { assertEndpoint, publicEndpoint } from "@/server/connection";
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
    try {
      const trustMode = parsed.data.trustMode ?? current.trustMode;
      const transport = parsed.data.transport ?? current.transport;
      const spkiSha256 = parsed.data.spkiSha256 === undefined ? current.spkiSha256 : parsed.data.spkiSha256;
      const url = assertEndpoint({ url: parsed.data.url ?? current.url, transport, trustMode, spkiSha256 });
      const endpoint = await prisma().connectionEndpoint.update({ where: { id }, data: { ...parsed.data, url, transport, trustMode, spkiSha256 } });
      return Response.json({ endpoint: publicEndpoint(endpoint) });
    } catch (error) {
      return jsonError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
    }
  });
}

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    try { await prisma().connectionEndpoint.delete({ where: { id } }); return Response.json({ ok: true }); }
    catch { return jsonError(404, "not_found", "Connection endpoint not found."); }
  });
}
