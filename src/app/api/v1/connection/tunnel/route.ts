import { z } from "zod";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";
import { remoteAccessState, setRemoteAccess } from "@/server/tunnel/remote-access";

const Body = z.object({ mode: z.enum(["off", "quick"]) }).strict();

export async function GET(request: Request) {
  return withAdmin(request, async () => Response.json({ tunnel: await remoteAccessState() }));
}

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Mode must be off or quick.");
    await setRemoteAccess(parsed.data.mode);
    return Response.json({ tunnel: await remoteAccessState() });
  });
}
