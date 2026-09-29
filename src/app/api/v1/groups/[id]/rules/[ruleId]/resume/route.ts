import { withMutation } from "@/server/guard";
import { INTERNET_RULE_ID, runGroupInternet } from "@/server/group-internet";
import { runLift } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Ends a pause. An allowance is ended by `disallow`. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    if (ruleId === INTERNET_RULE_ID) return runGroupInternet(request, session, "resume", id);
    return runLift(request, session, "resume", { ruleId, groupId: id });
  });
}
