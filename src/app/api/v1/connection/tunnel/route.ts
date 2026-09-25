import { z } from "zod";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";
import { RemoteAccessError, remoteAccessState, setRemoteAccess } from "@/server/tunnel/remote-access";

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("off"), forget: z.boolean().optional() }).strict(),
  z.object({ mode: z.literal("quick") }).strict(),
  z
    .object({ mode: z.literal("named"), hostname: z.string().max(253).optional(), endpointId: z.string().min(1).optional() })
    .strict()
    .refine((body) => !(body.hostname && body.endpointId), "Send a hostname or a route, not both."),
]);

export async function GET(request: Request) {
  return withAdmin(request, async () => Response.json({ tunnel: await remoteAccessState() }));
}

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Mode must be off, quick, or named with a hostname or a route id.");
    try {
      await setRemoteAccess(parsed.data);
    } catch (error) {
      if (error instanceof RemoteAccessError) return jsonError(400, "invalid_tunnel", error.message);
      throw error;
    }
    return Response.json({ tunnel: await remoteAccessState() });
  });
}
