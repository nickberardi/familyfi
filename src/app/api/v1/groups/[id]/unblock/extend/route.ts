import { withMutation } from "@/server/guard";
import { runGroupUnblock } from "@/server/group-unblock";

type Ctx = { params: Promise<{ id: string }> };

/** Adds `minutes` to the group's timed unblock. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return runGroupUnblock(request, session, "extend", id);
  });
}
