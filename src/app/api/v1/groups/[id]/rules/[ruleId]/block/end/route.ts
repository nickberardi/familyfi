import { withMutation } from "@/server/guard";
import { runGroupRuleBlock } from "@/server/group-rule-block";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Ends this group's block of the rule; its own schedule applies again. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    return runGroupRuleBlock(request, session, "end", id, ruleId);
  });
}
