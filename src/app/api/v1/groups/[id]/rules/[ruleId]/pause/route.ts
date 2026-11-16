import { withMutation } from "@/server/guard";
import { runGroupRuleLift } from "@/server/group-internet";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Suspends the rule until `until` or until resumed. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    return runGroupRuleLift(request, session, "pause", { groupId: id, ruleId });
  });
}
