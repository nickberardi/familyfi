import { withMutation } from "@/server/guard";
import { liftGroupRule } from "@/server/group-internet";
import { readLiftBody } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Overrides the rule while its window blocks, until `until` or until disallowed. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    const read = await readLiftBody(request, "allow");
    if (!read.ok) return read.response;
    return Response.json(await liftGroupRule(session, "allow", { groupId: id, ruleId }, read.body));
  });
}
