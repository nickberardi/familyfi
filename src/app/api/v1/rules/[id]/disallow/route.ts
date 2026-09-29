import { withMutation } from "@/server/guard";
import { runLift } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Ends an allowance. A pause is ended by `resume`. For every group the rule covers. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return runLift(request, session, "disallow", { ruleId: id });
  });
}
