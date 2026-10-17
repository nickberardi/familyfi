import { withMutation } from "@/server/guard";
import { runGroupUnblock } from "@/server/group-unblock";

type Ctx = { params: Promise<{ id: string }> };

/** Ends the group's unblock: every rule it allowed applies to the group again. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return runGroupUnblock(request, session, "end", id);
  });
}
