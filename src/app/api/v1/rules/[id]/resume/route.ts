import { withMutation } from "@/server/guard";
import { liftRule, readLiftBody } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Ends a pause. An allowance is ended by `disallow`. For every group the rule covers. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const read = await readLiftBody(request, "resume");
    if (!read.ok) return read.response;
    return Response.json(await liftRule(session, "resume", { ruleId: id }, read.body));
  });
}
