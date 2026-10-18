import { withMutation } from "@/server/guard";
import { runGroupUnblock } from "@/server/group-unblock";

type Ctx = { params: Promise<{ id: string }> };

/** Unblocks the group: its pause ends, and each rule blocking it now is allowed for it alone until that rule's windows end, or every rule until `until`. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return runGroupUnblock(request, session, "unblock", id);
  });
}
