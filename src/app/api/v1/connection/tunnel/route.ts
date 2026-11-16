import { z } from "zod";
import { readBody, withAdmin } from "@/server/guard";
import { changeRemoteAccess, remoteAccessState } from "@/server/tunnel/remote-access";

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
    const parsed = await readBody(request, Body, "Mode must be off, quick, or named with a hostname or a route id.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ tunnel: await changeRemoteAccess(parsed.data) });
  }, { demoLock: true });
}
