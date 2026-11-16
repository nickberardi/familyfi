import { LeftoverRemovalBody, removeConfirmedLeftovers } from "@/server/checkup-run";
import { readBody, withAdmin } from "@/server/guard";

export async function POST(request: Request) {
  // Every demo visitor shares one gateway.
  return withAdmin(request, async () => {
    const parsed = await readBody(request, LeftoverRemovalBody, "policyIds must list the policies to remove.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await removeConfirmedLeftovers(parsed.data.policyIds));
  }, { demoLock: true });
}
