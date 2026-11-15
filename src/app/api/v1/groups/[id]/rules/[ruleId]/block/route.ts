import { withMutation } from "@/server/guard";
import { runGroupRuleBlock } from "@/server/group-rule-block";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Blocks the rule's categories, apps or websites for this group now, until `until` or until ended, whatever its schedule says. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    return runGroupRuleBlock(request, session, "block", id, ruleId);
  });
}
