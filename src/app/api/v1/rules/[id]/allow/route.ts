import { withMutation } from "@/server/guard";
import { liftRule, readLiftBody } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Overrides the rule while its window blocks, until `until` or until disallowed. For every group the rule covers. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const read = await readLiftBody(request, "allow");
    if (!read.ok) return read.response;
    return Response.json(await liftRule(session, "allow", { ruleId: id }, read.body));
  });
}
