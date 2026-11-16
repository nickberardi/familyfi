import { z } from "zod";
import { removeConfirmedLeftovers } from "@/server/checkup-run";
import { readBody, withAdmin } from "@/server/guard";

const Body = z.object({ policyIds: z.array(z.string().min(1).max(200)).min(1).max(200) });

export async function POST(request: Request) {
  // Every demo visitor shares one gateway.
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "policyIds must list the policies to remove.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await removeConfirmedLeftovers(parsed.data.policyIds));
  }, { demoLock: true });
}
