import { prisma } from "@/server/db";
import { demoLocked } from "@/server/demo";
import { isManagedRoute } from "@/server/connection";
import { jsonError } from "@/server/http";
import { withAdmin } from "@/server/guard";
import { checkRoute } from "@/server/tunnel/route-check";

type Ctx = { params: Promise<{ id: string }> };

/** Asks a route the household runs for this household's identity, from home, and keeps what it found. */
export async function POST(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    // Routes are locked in the demo, and a check would reach any address from the demo's host.
    const locked = demoLocked();
    if (locked) return locked;
    const { id } = await context.params;
    const route = await prisma().connectionEndpoint.findUnique({ where: { id } });
    if (!route) return jsonError(404, "not_found", "Connection endpoint not found.");
    if (isManagedRoute(route)) return jsonError(409, "managed_route", "This route follows FamilyFi's own tunnel, which reports its own status.");
    const reachability = await checkRoute(id);
    if (!reachability) return jsonError(404, "not_found", "Connection endpoint not found.");
    return Response.json({ reachability });
  });
}
