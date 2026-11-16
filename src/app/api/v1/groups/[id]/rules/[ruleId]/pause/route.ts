import { withMutation } from "@/server/guard";
import { liftGroupRule } from "@/server/group-internet";
import { readLiftBody } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Suspends the rule until `until` or until resumed. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    const read = await readLiftBody(request, "pause");
    if (!read.ok) return read.response;
    return Response.json(await liftGroupRule(session, "pause", { groupId: id, ruleId }, read.body));
  });
}
