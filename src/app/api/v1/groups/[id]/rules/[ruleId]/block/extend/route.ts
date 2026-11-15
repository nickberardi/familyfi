import { withMutation } from "@/server/guard";
import { runGroupRuleBlock } from "@/server/group-rule-block";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Adds `minutes` to this group's timed block of the rule. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    return runGroupRuleBlock(request, session, "extend", id, ruleId);
  });
}
