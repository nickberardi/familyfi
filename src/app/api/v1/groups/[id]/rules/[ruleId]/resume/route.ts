import { withMutation } from "@/server/guard";
import { runGroupRuleLift } from "@/server/group-internet";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Ends a pause. An allowance is ended by `disallow`. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    return runGroupRuleLift(request, session, "resume", { groupId: id, ruleId });
  });
}
