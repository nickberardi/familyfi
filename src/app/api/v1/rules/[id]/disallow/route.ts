import { withMutation } from "@/server/guard";
import { liftRule, readLiftBody } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Ends an allowance. A pause is ended by `resume`. For every group the rule covers. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const read = await readLiftBody(request, "disallow");
    if (!read.ok) return read.response;
    return Response.json(await liftRule(session, "disallow", { ruleId: id }, read.body));
  });
}
