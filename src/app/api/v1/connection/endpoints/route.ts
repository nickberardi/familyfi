import { ConnectionTransport, ConnectionTrustMode, EdgeAuth } from "@prisma/client";
import { z } from "zod";
import { createEndpoint, listEndpoints } from "@/server/connection-endpoints";
import { readBody, withAdmin } from "@/server/guard";

const Body = z.object({
  url: z.string().min(1), transport: z.nativeEnum(ConnectionTransport), trustMode: z.nativeEnum(ConnectionTrustMode),
  spkiSha256: z.string().optional(), priority: z.number().int().min(0).max(999).optional(), enabled: z.boolean().optional(),
  edgeAuth: z.nativeEnum(EdgeAuth).optional(), serviceToken: z.object({ clientId: z.string(), clientSecret: z.string() }).strict().optional(),
});

export async function GET(request: Request) {
  return withAdmin(request, async () => Response.json({ endpoints: await listEndpoints() }));
}

export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "Provide a valid connection endpoint.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ endpoint: await createEndpoint(parsed.data) }, { status: 201 });
  }, { demoLock: true });
}
