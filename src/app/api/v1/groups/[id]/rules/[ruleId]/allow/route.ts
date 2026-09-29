import { withMutation } from "@/server/guard";
import { INTERNET_RULE_ID, runGroupInternet } from "@/server/group-internet";
import { runLift } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Overrides the rule while its window blocks, until `until` or until disallowed. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    if (ruleId === INTERNET_RULE_ID) return runGroupInternet(request, session, "allow", id);
    return runLift(request, session, "allow", { ruleId, groupId: id });
  });
}
