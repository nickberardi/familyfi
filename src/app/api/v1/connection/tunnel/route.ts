import { readBody, withAdmin } from "@/server/guard";
import { changeRemoteAccess, RemoteAccessBody, remoteAccessState } from "@/server/tunnel/remote-access";

export async function GET(request: Request) {
  return withAdmin(request, async () => Response.json({ tunnel: await remoteAccessState() }));
}

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, RemoteAccessBody, "Mode must be off, quick, or named with a hostname or a route id.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ tunnel: await changeRemoteAccess(parsed.data) });
  }, { demoLock: true });
}
