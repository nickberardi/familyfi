import { checkEndpoint } from "@/server/connection-endpoints";
import { withAdmin } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  // Routes are locked in the demo, and a check would reach any address from the demo's host.
  return withAdmin(request, async () => {
    const { id } = await context.params;
    return Response.json({ reachability: await checkEndpoint(id) });
  }, { demoLock: true });
}
