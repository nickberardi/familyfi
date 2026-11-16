import { withMutation } from "@/server/guard";
import { liftGroupRule } from "@/server/group-internet";
import { readLiftBody } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

/** Ends an allowance. A pause is ended by `resume`. For one group alone. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id, ruleId } = await ctx.params;
    const read = await readLiftBody(request, "disallow");
    if (!read.ok) return read.response;
    return Response.json(await liftGroupRule(session, "disallow", { groupId: id, ruleId }, read.body));
  });
}
